"""Modeling operations on OCCT shapes."""

from dataclasses import dataclass, field

from OCP.BRepAdaptor import BRepAdaptor_Surface
from OCP.BOPAlgo import BOPAlgo_GlueShift
from OCP.BRepAlgoAPI import BRepAlgoAPI_Cut, BRepAlgoAPI_Fuse
from OCP.BRepBuilderAPI import BRepBuilderAPI_Copy, BRepBuilderAPI_Transform
from OCP.BRep import BRep_Tool
from OCP.BRepFilletAPI import BRepFilletAPI_MakeChamfer, BRepFilletAPI_MakeFillet
from OCP.BRepLProp import BRepLProp_SLProps
from OCP.BRepPrimAPI import BRepPrimAPI_MakePrism
from OCP.BRepOffset import BRepOffset_MakeOffset, BRepOffset_Skin
from OCP.GeomAbs import GeomAbs_Arc
from OCP.BRepAdaptor import BRepAdaptor_Curve
from OCP.GeomAbs import GeomAbs_Plane
from OCP.gp import gp_Dir, gp_Pnt, gp_Trsf, gp_Vec
from OCP.ShapeUpgrade import ShapeUpgrade_UnifySameDomain
from OCP.TopAbs import TopAbs_COMPOUND, TopAbs_COMPSOLID, TopAbs_FACE, TopAbs_REVERSED, TopAbs_SOLID
from OCP.TopExp import TopExp_Explorer
from OCP.BRep import BRep_Builder
from OCP.TopoDS import TopoDS_CompSolid, TopoDS_Compound, TopoDS_Edge, TopoDS_Face, TopoDS_Iterator, TopoDS_Shape
from OCP.collections import List_TopoDS_Shape

from .subshapes import sub_shapes
from .volume import volume_of
from .opserrors import MIN_DISTANCE, OperationError  # noqa: F401
from .opsgeom import (  # noqa: F401
    MIN_PULL_COSINE,
    edge_curve,
    edge_outward_normal,
    face_handle_point,
    face_normal_at_edge,
    planar_normal,
    pull_direction,
)
from .validity import is_valid


@dataclass
class OpResult:
    shape: TopoDS_Shape
    # Faces in the result that the user's selection should follow.
    tracked_faces: list[TopoDS_Face]
    tracked_edges: list[TopoDS_Shape] = field(default_factory=list)
    tracked_vertices: list[TopoDS_Shape] = field(default_factory=list)
    # True once faces that share a surface have been merged; Tool.execute unifies results that are not.
    unified: bool = False
    # Whole-body transforms: the gp_Trsf applied to each solid, by index of the solid in the input (see recipes.py).
    moved: dict = field(default_factory=dict)
    # Push/pull: the volumes that cut (for the preview's ghost, see pushpull_modes.py), the ghost shape built from them,
    # and a plain note for the preview when the operation changed nothing.
    cutters: list = field(default_factory=list)
    ghost: TopoDS_Shape | None = None
    notice: str | None = None


def _follow(history_op, shapes: list[TopoDS_Shape]) -> list[TopoDS_Shape]:
    """Map shapes through an operation's Modified/deleted history.

    Works with both BRepBuilderAPI operations (IsDeleted) and BRepTools_History (IsRemoved).
    """
    is_deleted = getattr(history_op, "IsDeleted", None) or history_op.IsRemoved
    result = []
    for shape in shapes:
        modified: List_TopoDS_Shape = history_op.Modified(shape)
        if modified.Size() > 0:
            result.extend(modified)
        elif not is_deleted(shape):
            result.append(shape)
    return result


def _boolean(shape: TopoDS_Shape, tool: TopoDS_Shape, fuse: bool, glue: bool):
    operation = BRepAlgoAPI_Fuse() if fuse else BRepAlgoAPI_Cut()
    arguments, tools = List_TopoDS_Shape(), List_TopoDS_Shape()
    arguments.Append(shape)
    tools.Append(tool)
    operation.SetArguments(arguments)
    operation.SetTools(tools)
    operation.SetRunParallel(True)
    # Never modify the inputs: they belong to the document, and previews run on them repeatedly.
    operation.SetNonDestructive(True)
    if glue:
        operation.SetGlue(BOPAlgo_GlueShift)
    operation.Build()
    if not operation.IsDone() or operation.Shape().IsNull():
        return None
    return operation


def solids_of(shape: TopoDS_Shape) -> list[TopoDS_Shape]:
    """The bodies of a shape: each solid, or each compound body (a CompSolid grouping several solids, see `group`)."""
    if shape.IsNull():
        return []
    kind = shape.ShapeType()
    if kind in (TopAbs_SOLID, TopAbs_COMPSOLID):
        return [shape]
    out: list[TopoDS_Shape] = []
    if kind == TopAbs_COMPOUND:
        it = TopoDS_Iterator(shape)
        while it.More():
            out.extend(solids_of(it.Value()))
            it.Next()
    return out


def group(solids: list[TopoDS_Shape]) -> TopoDS_Shape:
    """One body from several solids: the solid itself for one, otherwise a CompSolid holding them all."""
    flat = [s for body in solids for s in _inner_solids(body)]
    if len(flat) == 1:
        return flat[0]
    grouped, builder = TopoDS_CompSolid(), BRep_Builder()
    builder.MakeCompSolid(grouped)
    for s in flat:
        builder.Add(grouped, s)
    return grouped


def _inner_solids(shape: TopoDS_Shape) -> list[TopoDS_Shape]:
    return sub_shapes(shape, TopAbs_SOLID)


def keep_compound(old: TopoDS_Shape, new: TopoDS_Shape) -> TopoDS_Shape:
    """`new` with its solids grouped again when the model was a single compound body and an operation split it up
    (with several bodies the tools that handle each body on its own call `regroup` themselves)."""
    olds = solids_of(old)
    if new is old or not any(o.ShapeType() == TopAbs_COMPSOLID for o in olds):
        return new
    news = solids_of(new)
    if len(news) < 2:
        return new
    compound, builder = TopoDS_Compound(), BRep_Builder()
    builder.MakeCompound(compound)
    if len(olds) == 1:
        builder.Add(compound, group(news))
        return compound
    # Several bodies: match the new plain solids to the old compound bodies' solids (as body identity does) and
    # group the ones that came from the same compound body again.
    from .bodies import Body, BodyState, carry

    flat: list[TopoDS_Shape] = []
    owner: list[int] = []
    for k, body in enumerate(olds):
        inner = _inner_solids(body) if body.ShapeType() == TopAbs_COMPSOLID else [body]
        flat.extend(inner)
        owner.extend([k if body.ShapeType() == TopAbs_COMPSOLID else -1] * len(inner))
    plain = [s for n in news for s in _inner_solids(n)]  # a boolean can leave a compound body as several one-solid groups
    old_flat, new_plain = TopoDS_Compound(), TopoDS_Compound()
    for target, items in ((old_flat, flat), (new_plain, plain)):
        builder.MakeCompound(target)
        for item in items:
            builder.Add(target, item)
    state = carry(BodyState(tuple(Body(i, "") for i in range(len(flat))), len(flat)), old_flat, new_plain)
    members: dict[int, list[int]] = {}  # compound body index -> positions in `plain`
    for position, matched in enumerate(state.bodies):
        if matched.id < len(flat) and owner[matched.id] >= 0:
            members.setdefault(owner[matched.id], []).append(position)
    if not any(len(m) > 1 for m in members.values()):
        return new
    first = {m[0]: m for m in members.values() if len(m) > 1}
    skip = {p for m in members.values() if len(m) > 1 for p in m[1:]}
    builder.MakeCompound(compound)
    for position, item in enumerate(plain):
        if position not in skip:
            builder.Add(compound, group([plain[p] for p in first[position]]) if position in first else item)
    return compound


def regroup(original: TopoDS_Shape, result: TopoDS_Shape) -> TopoDS_Shape:
    """`result` made a compound body again when it came from one (an operation on a compound body may return a plain compound)."""
    if original.ShapeType() == TopAbs_COMPSOLID and result.ShapeType() != TopAbs_SOLID:
        if len(_inner_solids(result)) > 1:
            return group([result])
    return result


def _faces_of(shape: TopoDS_Shape) -> list[TopoDS_Shape]:
    return sub_shapes(shape, TopAbs_FACE)


_volume_of = volume_of


def unify_result(result: OpResult) -> OpResult:
    """Merge faces and edges that share a surface or curve, following the tracked shapes through the merge."""
    # UnifySameDomain modifies its input in place, even in "safe input" mode,
    # and the result of an operation shares sub-shapes with the document's shape.
    # Unifying a topology-only copy keeps the original intact; geometry and
    # triangulations are shared, so the copy is cheap.
    copy = BRepBuilderAPI_Copy(result.shape, False, True)
    tracked_c = _follow(copy, result.tracked_faces)
    edges_c = _follow(copy, result.tracked_edges)
    vertices_c = _follow(copy, result.tracked_vertices)

    unify = ShapeUpgrade_UnifySameDomain(copy.Shape(), True, True, True)
    unify.Build()
    merged = unify.Shape()
    if not merged.IsNull() and is_valid(merged):
        tracked = _follow(unify.History(), tracked_c)
        edges = _follow(unify.History(), edges_c)
        vertices = _follow(unify.History(), vertices_c)
    else:
        # Merging coplanar faces can corrupt very detailed solids; the plain result is still valid.
        merged = copy.Shape()
        tracked, edges, vertices = tracked_c, edges_c, vertices_c
        if merged.IsNull() or not is_valid(merged):  # only the fallback needs its own check: the merged shape just passed
            raise OperationError("Operation produced invalid geometry")
    return OpResult(merged, tracked, edges, vertices, unified=True)


def fillet_chamfer(shape: TopoDS_Shape, edges: list[TopoDS_Edge], distance: float) -> OpResult:
    """Round or bevel edges: positive distances make a fillet of that radius,
    negative distances a chamfer of that size. The generated faces are tracked."""
    if abs(distance) < MIN_DISTANCE:
        return OpResult(shape, [], list(edges))
    size = abs(distance)
    maker = BRepFilletAPI_MakeFillet(shape) if distance > 0 else BRepFilletAPI_MakeChamfer(shape)
    for edge in edges:
        maker.Add(size, edge)
    try:
        maker.Build()
    except Exception as e:  # OCCT raises Standard_Failure for impossible sizes
        raise OperationError(f"Could not {'fillet' if distance > 0 else 'chamfer'}: {e}") from None
    if not maker.IsDone() or maker.Shape().IsNull():
        raise OperationError("Could not " + ("fillet" if distance > 0 else "chamfer") + " these edges at this size")
    result = maker.Shape()
    if not is_valid(result):
        raise OperationError("Operation produced invalid geometry")
    generated = []
    for edge in edges:
        generated.extend(maker.Generated(edge))
    return OpResult(result, generated)


# The push/pull family lives in pushpull.py, which imports this module; its names are looked up there on first use so every name
# stays importable from ops and neither module has to be imported first.
_PUSHPULL = ("push_pull", "_is_sheet_model", "_push_pull_sheets", "_contains", "_curved_prism", "_push_pull")


def __getattr__(name: str):
    if name in _PUSHPULL:
        from . import pushpull

        return getattr(pushpull, name)
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")

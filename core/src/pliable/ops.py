"""Modeling operations on OCCT shapes."""

from dataclasses import dataclass, field

from OCP.BRepAdaptor import BRepAdaptor_Surface
from OCP.BOPAlgo import BOPAlgo_GlueShift
from OCP.BRepAlgoAPI import BRepAlgoAPI_Cut, BRepAlgoAPI_Fuse
from OCP.BRepBuilderAPI import BRepBuilderAPI_Copy
from OCP.BRep import BRep_Tool
from OCP.BRepCheck import BRepCheck_Analyzer
from OCP.BRepFilletAPI import BRepFilletAPI_MakeChamfer, BRepFilletAPI_MakeFillet
from OCP.BRepLProp import BRepLProp_SLProps
from OCP.BRepPrimAPI import BRepPrimAPI_MakePrism
from OCP.BRepAdaptor import BRepAdaptor_Curve
from OCP.GeomAbs import GeomAbs_Plane
from OCP.gp import gp_Dir, gp_Vec
from OCP.ShapeUpgrade import ShapeUpgrade_UnifySameDomain
from OCP.TopAbs import TopAbs_FACE, TopAbs_REVERSED, TopAbs_SOLID
from OCP.TopExp import TopExp_Explorer
from OCP.BRep import BRep_Builder
from OCP.TopoDS import TopoDS_Compound, TopoDS_Edge, TopoDS_Face, TopoDS_Shape
from OCP.collections import List_TopoDS_Shape

MIN_DISTANCE = 1e-4


class OperationError(Exception):
    pass


def planar_normal(face: TopoDS_Face) -> gp_Dir | None:
    """Outward normal of a planar face, or None if the face isn't planar."""
    surface = BRepAdaptor_Surface(face)
    if surface.GetType() != GeomAbs_Plane:
        return None
    normal = surface.Plane().Axis().Direction()
    if face.Orientation() == TopAbs_REVERSED:
        normal = normal.Reversed()
    return normal


@dataclass
class OpResult:
    shape: TopoDS_Shape
    # Faces in the result that the user's selection should follow.
    tracked_faces: list[TopoDS_Face]
    tracked_edges: list[TopoDS_Shape] = field(default_factory=list)
    tracked_vertices: list[TopoDS_Shape] = field(default_factory=list)


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
    explorer = TopExp_Explorer(shape, TopAbs_SOLID)
    solids = []
    while explorer.More():
        solids.append(explorer.Current())
        explorer.Next()
    return solids


def push_pull(
    shape: TopoDS_Shape,
    face: TopoDS_Face | list[TopoDS_Face],
    distance: float,
    preview: bool = False,
    follow_edges: list[TopoDS_Shape] | None = None,
    follow_vertices: list[TopoDS_Shape] | None = None,
) -> OpResult:
    """Push/pull acting only on the solid that contains the face(s).

    In a file with several solids (stacked, touching or overlapping parts), fusing the
    extrusion with the whole compound fails or merges parts, so the other solids are left
    exactly as they are and the changed solid is put back in its place.
    """
    solids = solids_of(shape)
    faces = face if isinstance(face, list) else [face]
    if len(solids) < 2 or not faces:
        return _push_pull(shape, face, distance, preview, follow_edges, follow_vertices)
    owners = set()
    for f in faces:
        for i, solid in enumerate(solids):
            if _contains(solid, f):
                owners.add(i)
                break
    if not owners:
        raise OperationError("This face is not part of a closed solid (the file has an open shell here), so push/pull can't work on it")
    if len(owners) != 1:
        raise OperationError("The selected faces belong to different solids; select faces of one solid")
    index = owners.pop()
    result = _push_pull(solids[index], face, distance, preview, follow_edges, follow_vertices)
    compound, builder = TopoDS_Compound(), BRep_Builder()
    builder.MakeCompound(compound)
    for i, solid in enumerate(solids):
        builder.Add(compound, result.shape if i == index else solid)
    result.shape = compound
    return result


def _contains(solid: TopoDS_Shape, face: TopoDS_Face) -> bool:
    explorer = TopExp_Explorer(solid, TopAbs_FACE)
    while explorer.More():
        if explorer.Current().IsSame(face):
            return True
        explorer.Next()
    return False


def _push_pull(
    shape: TopoDS_Shape,
    face: TopoDS_Face | list[TopoDS_Face],
    distance: float,
    preview: bool = False,
    follow_edges: list[TopoDS_Shape] | None = None,
    follow_vertices: list[TopoDS_Shape] | None = None,
) -> OpResult:
    """Extrude a planar face along its outward normal.

    Positive distances add material, negative distances remove it.

    With preview=True the boolean runs in OCCT's "glue" mode, which is several
    times faster on large models because the extrusion shares its base face
    with the solid. Glue mode assumes the extrusion doesn't otherwise
    intersect the solid, so it can be wrong when pushing into other geometry;
    previews accept that risk (falling back if the result is invalid), and
    commits always use the exact boolean.

    `follow_edges` and `follow_vertices` are carried through the operation's
    history and returned in the result's tracked lists (deleted ones drop out).
    """
    faces = face if isinstance(face, list) else [face]
    if abs(distance) < MIN_DISTANCE:
        return OpResult(shape, list(faces), list(follow_edges or []), list(follow_vertices or []))
    prisms, moved_faces = [], []
    for f in faces:
        normal = planar_normal(f)
        if normal is None:
            raise OperationError("Push/pull currently supports planar faces only")
        prism = BRepPrimAPI_MakePrism(f, gp_Vec(normal).Multiplied(distance))
        prism.Build()
        if not prism.IsDone():
            raise OperationError("Could not build extrusion")
        prisms.append(prism.Shape())
        moved_faces.append(prism.LastShape())
    if len(prisms) == 1:
        tool = prisms[0]
    else:
        tool = TopoDS_Compound()
        builder = BRep_Builder()
        builder.MakeCompound(tool)
        for p in prisms:
            builder.Add(tool, p)

    boolean = None
    if preview:
        boolean = _boolean(shape, tool, distance > 0, glue=True)
        if boolean is not None and not BRepCheck_Analyzer(boolean.Shape()).IsValid():
            boolean = None
    if boolean is None:
        boolean = _boolean(shape, tool, distance > 0, glue=False)
    if boolean is None:
        raise OperationError("Boolean operation failed")
    tracked = _follow(boolean, moved_faces)
    edges = _follow(boolean, list(follow_edges or []))
    vertices = _follow(boolean, list(follow_vertices or []))

    # UnifySameDomain modifies its input in place, even in "safe input" mode,
    # and the boolean result shares sub-shapes with the document's shape.
    # Unifying a topology-only copy keeps the original intact; geometry and
    # triangulations are shared, so the copy is cheap.
    copy = BRepBuilderAPI_Copy(boolean.Shape(), False, True)
    tracked_c = _follow(copy, tracked)
    edges_c = _follow(copy, edges)
    vertices_c = _follow(copy, vertices)

    unify = ShapeUpgrade_UnifySameDomain(copy.Shape(), True, True, True)
    unify.Build()
    result = unify.Shape()
    if not result.IsNull() and BRepCheck_Analyzer(result).IsValid():
        tracked = _follow(unify.History(), tracked_c)
        edges = _follow(unify.History(), edges_c)
        vertices = _follow(unify.History(), vertices_c)
    else:
        # Merging coplanar faces can corrupt very detailed solids; the plain boolean result is still valid.
        result = copy.Shape()
        tracked, edges, vertices = tracked_c, edges_c, vertices_c

    if result.IsNull() or not BRepCheck_Analyzer(result).IsValid():
        raise OperationError("Operation produced invalid geometry")
    return OpResult(result, tracked, edges, vertices)


def face_normal_at_edge(face: TopoDS_Face, edge: TopoDS_Edge) -> gp_Dir | None:
    """Outward normal of `face` at the middle of `edge` (which must lie on it)."""
    curve2d = BRep_Tool.CurveOnSurface_s(edge, face, 0.0, 1.0)
    if curve2d is None:
        return None
    first, last = BRep_Tool.Range_s(edge, face)
    uv = curve2d.Value((first + last) / 2)
    props = BRepLProp_SLProps(BRepAdaptor_Surface(face), uv.X(), uv.Y(), 1, 1e-6)
    if not props.IsNormalDefined():
        return None
    normal = props.Normal()
    return normal.Reversed() if face.Orientation() == TopAbs_REVERSED else normal


def edge_outward_normal(topology, edge: TopoDS_Edge) -> list[float] | None:
    """Unit direction pointing away from the material at an edge: the bisector
    of the adjacent faces' outward normals. This is the axis along which
    dragging the edge outward makes a fillet and inward makes a chamfer."""
    total = gp_Vec(0, 0, 0)
    for face in topology.edge_faces(edge):
        normal = face_normal_at_edge(face, edge)
        if normal is not None:
            total.Add(gp_Vec(normal))
    if total.Magnitude() < 1e-6:
        return None
    total.Normalize()
    return [total.X(), total.Y(), total.Z()]


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
    if not BRepCheck_Analyzer(result).IsValid():
        raise OperationError("Operation produced invalid geometry")
    generated = []
    for edge in edges:
        generated.extend(maker.Generated(edge))
    return OpResult(result, generated)

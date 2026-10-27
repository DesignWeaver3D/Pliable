"""Modeling operations on OCCT shapes."""

from dataclasses import dataclass, field

from OCP.BRepAdaptor import BRepAdaptor_Surface
from OCP.BOPAlgo import BOPAlgo_GlueShift
from OCP.BRepAlgoAPI import BRepAlgoAPI_Cut, BRepAlgoAPI_Fuse
from OCP.BRepBuilderAPI import BRepBuilderAPI_Copy, BRepBuilderAPI_Transform
from OCP.BRep import BRep_Tool
from OCP.BRepCheck import BRepCheck_Analyzer
from OCP.BRepFilletAPI import BRepFilletAPI_MakeChamfer, BRepFilletAPI_MakeFillet
from OCP.BRepLProp import BRepLProp_SLProps
from OCP.BRepPrimAPI import BRepPrimAPI_MakePrism
from OCP.BRepOffset import BRepOffset_MakeOffset, BRepOffset_Skin
from OCP.GeomAbs import GeomAbs_Arc
from OCP.BRepAdaptor import BRepAdaptor_Curve
from OCP.GeomAbs import GeomAbs_Plane
from OCP.gp import gp_Dir, gp_Pnt, gp_Trsf, gp_Vec
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


MIN_PULL_COSINE = 0.05  # a pull direction within about 3 degrees of a face's own plane would make a sliver, not an extrusion


def pull_direction(normal: gp_Dir, direction=None) -> gp_Vec:
    """The unit direction a face is pushed or pulled along: its normal, or the chosen `direction` (x, y, z) turned to point
    out of the face (a picked edge has no sign of its own). A direction along the face itself is refused."""
    if direction is None:
        return gp_Vec(normal)
    vector = gp_Vec(*direction)
    if vector.Magnitude() < 1e-9:
        return gp_Vec(normal)
    vector.Normalize()
    cosine = vector.Dot(gp_Vec(normal))
    if abs(cosine) < MIN_PULL_COSINE:
        raise OperationError("That direction lies along the face; pick one that points out of it")
    return vector if cosine > 0 else vector.Reversed()


def edge_curve(edge: TopoDS_Edge):
    """(point_at, tangent_at, length) helpers for an edge: `point_at(u)` and `tangent_at(u)` take u from 0 (the edge's
    first end) to 1 (its last) and give xyz tuples (the tangent is a unit vector); length is the arc length."""
    from OCP.BRepAdaptor import BRepAdaptor_Curve
    from OCP.BRepGProp import BRepGProp
    from OCP.GProp import GProp_GProps

    curve = BRepAdaptor_Curve(edge)
    first, last = curve.FirstParameter(), curve.LastParameter()

    def point_at(u: float):
        p = curve.Value(first + (last - first) * u)
        return (p.X(), p.Y(), p.Z())

    def tangent_at(u: float):
        p, v = gp_Pnt(), gp_Vec()
        curve.D1(first + (last - first) * u, p, v)
        m = v.Magnitude() or 1.0
        return (v.X() / m, v.Y() / m, v.Z() / m)

    props = GProp_GProps()
    BRepGProp.LinearProperties_s(edge, props)
    return point_at, tangent_at, props.Mass()


def face_handle_point(face: TopoDS_Face) -> gp_Pnt:
    """A point on a planar face to hang an on-screen handle on: the centre of mass when it lies on the face, else the
    middle of the face's longest boundary edge (an L-shaped or ring-shaped face has its centre of mass off the face)."""
    from OCP.BRepClass import BRepClass_FaceClassifier
    from OCP.BRepGProp import BRepGProp
    from OCP.GProp import GProp_GProps
    from OCP.TopAbs import TopAbs_IN
    from OCP.TopExp import TopExp_Explorer
    from OCP.TopAbs import TopAbs_EDGE
    from OCP.TopoDS import TopoDS

    props = GProp_GProps()
    BRepGProp.SurfaceProperties_s(face, props)
    centre = props.CentreOfMass()
    if BRepClass_FaceClassifier(face, centre, 1e-6).State() == TopAbs_IN:
        return centre
    best, best_length = centre, -1.0
    explorer = TopExp_Explorer(face, TopAbs_EDGE)
    while explorer.More():
        edge_props = GProp_GProps()
        BRepGProp.LinearProperties_s(explorer.Current(), edge_props)
        if edge_props.Mass() > best_length:
            best, best_length = edge_props.CentreOfMass(), edge_props.Mass()
        explorer.Next()
    return best


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
    symmetric: bool = False,
    direction=None,
) -> OpResult:
    """Push/pull acting only on the solid that contains the face(s).

    In a file with several solids (stacked, touching or overlapping parts), fusing the
    extrusion with the whole compound fails or merges parts, so the other solids are left
    exactly as they are and the changed solid is put back in its place.
    """
    solids = solids_of(shape)
    faces = face if isinstance(face, list) else [face]
    sheets = [f for f in faces if not any(_contains(solid, f) for solid in solids)] if solids or _is_sheet_model(shape, faces) else []
    if sheets and len(sheets) == len(faces):
        return _push_pull_sheets(shape, faces, distance, symmetric, direction)
    if sheets:
        raise OperationError("Select either faces of a solid or loose faces made from a sketch, not both")
    if len(solids) < 2 or not faces:
        return _push_pull(shape, face, distance, preview, follow_edges, follow_vertices, direction)
    owners = set()
    for f in faces:
        for i, solid in enumerate(solids):
            if _contains(solid, f):
                owners.add(i)
                break
    if not owners:
        raise OperationError("This face is not part of a closed solid (the file has an open shell here), so push/pull can't work on it")
    changed, results = {}, []
    for index in sorted(owners):  # each solid is pushed or pulled on its own (faces of several solids, such as coplanar ones, move together)
        own = [f for f in faces if _contains(solids[index], f)]
        result = _push_pull(solids[index], own if len(own) > 1 else own[0], distance, preview, follow_edges if not results else None, follow_vertices if not results else None, direction)
        changed[index] = result.shape
        results.append(result)
    result = results[0]
    for other in results[1:]:
        result.tracked_faces = result.tracked_faces + other.tracked_faces
    compound, builder = TopoDS_Compound(), BRep_Builder()
    builder.MakeCompound(compound)
    for i, solid in enumerate(solids):
        builder.Add(compound, changed.get(i, solid))
    result.shape = compound
    return result


def _is_sheet_model(shape: TopoDS_Shape, faces: list[TopoDS_Face]) -> bool:
    return not solids_of(shape) and any(_contains(shape, f) for f in faces)


def _faces_of(shape: TopoDS_Shape) -> list[TopoDS_Shape]:
    explorer, faces = TopExp_Explorer(shape, TopAbs_FACE), []
    while explorer.More():
        faces.append(explorer.Current())
        explorer.Next()
    return faces


def _volume_of(shape: TopoDS_Shape) -> float:
    from OCP.BRepGProp import BRepGProp
    from OCP.GProp import GProp_GProps

    props = GProp_GProps()
    BRepGProp.VolumeProperties_s(shape, props)
    return props.Mass()


def _push_pull_sheets(shape: TopoDS_Shape, faces: list[TopoDS_Face], distance: float, symmetric: bool = False, direction=None) -> OpResult:
    """Push/pull on loose faces (regions of a closed sketch): extrude them along their normal into solids.
    A negative distance cuts into the model where the face overlaps it; otherwise (and for positive
    distances) the new solid is fused with what it touches or stands on its own. Symmetric: the face's own plane is the
    middle and it is pushed `distance` to each side (the cap that follows the pointer is on the normal's side)."""
    if abs(distance) < MIN_DISTANCE:
        return OpResult(shape, list(faces), unified=True)
    prisms, caps = [], []
    for f in faces:
        normal = planar_normal(f)
        if normal is None:
            raise OperationError("Push/pull currently supports planar faces only")
        start, vector = f, pull_direction(normal, direction).Multiplied(distance)
        if symmetric:
            trsf = gp_Trsf()
            trsf.SetTranslation(gp_Vec(normal).Multiplied(-distance))
            start, vector = BRepBuilderAPI_Transform(f, trsf, True).Shape(), gp_Vec(normal).Multiplied(2 * distance)
        prism = BRepPrimAPI_MakePrism(start, vector)
        prism.Build()
        if not prism.IsDone():
            raise OperationError("Could not build extrusion")
        prisms.append(prism.Shape())
        caps.append(prism.LastShape())
    solids = solids_of(shape)
    others = [f for f in _faces_of(shape) if not any(f.IsSame(p) for p in faces) and not any(_contains(solid, f) for solid in solids)]
    builder = BRep_Builder()
    tool = TopoDS_Compound()
    builder.MakeCompound(tool)
    for p in prisms:
        builder.Add(tool, p)
    combined = TopoDS_Compound()
    builder.MakeCompound(combined)
    if solids:
        # Booleans run on the solids alone; free faces (other sketch regions) are put back afterwards.
        body = TopoDS_Compound()
        builder.MakeCompound(body)
        for solid in solids:
            builder.Add(body, solid)
        boolean = None
        if distance < 0:
            cut = _boolean(body, tool, False, glue=False)
            if cut is not None and _volume_of(cut.Shape()) < _volume_of(body) - 1e-6:
                boolean = cut
        if boolean is None:
            boolean = _boolean(body, tool, True, glue=False)
        if boolean is None:
            raise OperationError("Boolean operation failed")
        builder.Add(combined, boolean.Shape())
        tracked = _follow(boolean, caps)
    else:
        for p in prisms:
            builder.Add(combined, p)
        tracked = caps
    for f in others:
        builder.Add(combined, f)
    return unify_result(OpResult(combined, tracked))


def _contains(solid: TopoDS_Shape, face: TopoDS_Face) -> bool:
    explorer = TopExp_Explorer(solid, TopAbs_FACE)
    while explorer.More():
        if explorer.Current().IsSame(face):
            return True
        explorer.Next()
    return False



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
    if not merged.IsNull() and BRepCheck_Analyzer(merged).IsValid():
        tracked = _follow(unify.History(), tracked_c)
        edges = _follow(unify.History(), edges_c)
        vertices = _follow(unify.History(), vertices_c)
    else:
        # Merging coplanar faces can corrupt very detailed solids; the plain result is still valid.
        merged = copy.Shape()
        tracked, edges, vertices = tracked_c, edges_c, vertices_c

    if merged.IsNull() or not BRepCheck_Analyzer(merged).IsValid():
        raise OperationError("Operation produced invalid geometry")
    return OpResult(merged, tracked, edges, vertices, unified=True)


def _curved_prism(face: TopoDS_Face, distance: float) -> tuple[TopoDS_Shape, TopoDS_Shape]:
    """A solid slab between a curved face and its copy moved `distance` along the surface normal (the face's
    outward side when positive), for embossing or cutting a patch of a cylinder, cone or similar surface."""
    offset = BRepOffset_MakeOffset(face, distance, 1e-4, BRepOffset_Skin, False, False, GeomAbs_Arc, True, False)
    if not offset.IsDone() or offset.Shape().ShapeType() != TopAbs_SOLID:
        raise OperationError("This curved face can't be pushed or pulled along its surface (the offset failed)")
    solid = offset.Shape()
    moved = list(offset.Modified(face))
    return solid, (moved[0] if moved else solid)


def _push_pull(
    shape: TopoDS_Shape,
    face: TopoDS_Face | list[TopoDS_Face],
    distance: float,
    preview: bool = False,
    follow_edges: list[TopoDS_Shape] | None = None,
    follow_vertices: list[TopoDS_Shape] | None = None,
    direction=None,
) -> OpResult:
    """Extrude a planar face along its outward normal (or along `direction`, see pull_direction).

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
        return OpResult(shape, list(faces), list(follow_edges or []), list(follow_vertices or []), unified=True)
    prisms, moved_faces = [], []
    for f in faces:
        normal = planar_normal(f)
        if normal is None:
            solid, moved = _curved_prism(f, distance)
            prisms.append(solid)
            moved_faces.append(moved)
            continue
        prism = BRepPrimAPI_MakePrism(f, pull_direction(normal, direction).Multiplied(distance))
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
        # Glue mode can return the solid unchanged when a cut reaches past the far side; the exact boolean cuts through.
        if boolean is not None and distance < 0 and _volume_of(boolean.Shape()) > _volume_of(shape) - 1e-6:
            boolean = None
    if boolean is None:
        boolean = _boolean(shape, tool, distance > 0, glue=False)
    if boolean is None:
        raise OperationError("Boolean operation failed")
    if distance < 0 and not solids_of(boolean.Shape()):
        raise OperationError("That would cut away the whole solid; use a smaller distance")
    tracked = _follow(boolean, moved_faces)
    edges = _follow(boolean, list(follow_edges or []))
    vertices = _follow(boolean, list(follow_vertices or []))

    return unify_result(OpResult(boolean.Shape(), tracked, edges, vertices))


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

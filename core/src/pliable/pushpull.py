"""Push/pull of faces: extruding or cutting along a face normal, on the one solid that holds the face."""

from OCP.BRep import BRep_Builder
from OCP.BRepOffset import BRepOffset_MakeOffset, BRepOffset_Skin
from OCP.BRepPrimAPI import BRepPrimAPI_MakePrism
from OCP.GeomAbs import GeomAbs_Arc
from OCP.TopAbs import TopAbs_FACE, TopAbs_SOLID
from OCP.TopExp import TopExp_Explorer
from OCP.TopoDS import TopoDS_Compound, TopoDS_Face, TopoDS_Shape

from .ops import OpResult, _boolean, _follow, _volume_of, regroup, solids_of, unify_result
from .opserrors import MIN_DISTANCE, OperationError
from .opsgeom import planar_normal, pull_direction


def push_pull(
    shape: TopoDS_Shape,
    face: TopoDS_Face | list[TopoDS_Face],
    distance: float,
    preview: bool = False,
    follow_edges: list[TopoDS_Shape] | None = None,
    follow_vertices: list[TopoDS_Shape] | None = None,
    symmetric: bool = False,
    direction=None,
    mode: str = "auto",
    flip: bool = False,
) -> OpResult:
    """Push/pull acting only on the solid that contains the face(s).

    In a file with several solids (stacked, touching or overlapping parts), fusing the
    extrusion with the whole compound fails or merges parts, so the other solids are left
    exactly as they are and the changed solid is put back in its place.
    """
    solids = solids_of(shape)
    faces = face if isinstance(face, list) else [face]
    sheets = [f for f in faces if not any(_contains(solid, f) for solid in solids)] if solids or _is_sheet_model(shape, faces) else []
    solid_sign = 1.0
    if sheets and len(faces) > 1 and not symmetric and direction is None and mode != "new":
        from .pushpull_modes import align_to_first

        faces, sheets, solid_sign = align_to_first(faces, sheets)  # faces facing the other way take the first face's normal
    if sheets and len(sheets) == len(faces):
        return _push_pull_sheets(shape, faces, distance, symmetric, direction, preview, mode, flip)
    if sheets and mode != "new":
        from .pushpull_modes import push_pull_mixed

        return push_pull_mixed(shape, faces, sheets, distance, preview, follow_edges, follow_vertices, symmetric, direction, mode, flip, solid_sign)
    if mode == "new" and faces:
        from .pushpull_modes import new_bodies

        return new_bodies(shape, faces, distance, symmetric, direction)
    if len(solids) < 2 or not faces:
        return _push_pull(shape, face, distance, preview, follow_edges, follow_vertices, direction, mode, flip)
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
        result = _push_pull(solids[index], own if len(own) > 1 else own[0], distance, preview, follow_edges if not results else None, follow_vertices if not results else None, direction, mode, flip)
        changed[index] = result.shape
        results.append(result)
    result = results[0]
    for other in results[1:]:
        result.tracked_faces = result.tracked_faces + other.tracked_faces
        result.cutters = result.cutters + other.cutters
    compound, builder = TopoDS_Compound(), BRep_Builder()
    builder.MakeCompound(compound)
    for i, solid in enumerate(solids):
        builder.Add(compound, regroup(solid, changed[i]) if i in changed else solid)
    result.shape = compound
    return result


def _is_sheet_model(shape: TopoDS_Shape, faces: list[TopoDS_Face]) -> bool:
    return not solids_of(shape) and any(_contains(shape, f) for f in faces)


def _push_pull_sheets(shape: TopoDS_Shape, faces: list[TopoDS_Face], distance: float, symmetric: bool = False, direction=None, preview: bool = False, mode: str = "auto", flip: bool = False) -> OpResult:
    """Push/pull on loose faces (regions of a closed sketch): extrude them along their normal into solids; see pushpull_modes.py."""
    from .pushpull_modes import push_pull_sheets

    return push_pull_sheets(shape, faces, distance, symmetric, direction, preview, mode, flip)


def _contains(solid: TopoDS_Shape, face: TopoDS_Face) -> bool:
    explorer = TopExp_Explorer(solid, TopAbs_FACE)
    while explorer.More():
        if explorer.Current().IsSame(face):
            return True
        explorer.Next()
    return False


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
    mode: str = "auto",
    flip: bool = False,
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

    from .pushpull_modes import nothing_to_subtract, push_role

    fuse = push_role(mode, flip, distance) == "add"
    ordinary = fuse == (distance > 0)  # the extrusion is added when pulled and cut when pushed, as the extrusion's own side suggests

    def finished(boolean) -> OpResult:
        if not fuse and not solids_of(boolean.Shape()):
            raise OperationError("That would cut away the whole solid; use a smaller distance")
        if not fuse and not ordinary and _volume_of(boolean.Shape()) > _volume_of(shape) - 1e-6:
            return nothing_to_subtract(shape, faces, [tool], preview)
        tracked = _follow(boolean, moved_faces)
        edges = _follow(boolean, list(follow_edges or []))
        vertices = _follow(boolean, list(follow_vertices or []))
        result = unify_result(OpResult(boolean.Shape(), tracked, edges, vertices), align=not preview)
        if not fuse:
            result.cutters = [tool]
        return result

    if preview and ordinary:
        boolean = _boolean(shape, tool, fuse, glue=True)
        # Glue mode can return the solid unchanged when a cut reaches past the far side; the exact boolean cuts through.
        if boolean is not None and not fuse and _volume_of(boolean.Shape()) > _volume_of(shape) - 1e-6:
            boolean = None
        if boolean is not None:
            # The glued result is not checked on its own: merging its faces ends with the validity check, and that
            # check costs several times the glued boolean on a model with hundreds of faces. A bad glued result
            # fails there and the exact boolean takes over.
            try:
                return finished(boolean)
            except OperationError:
                pass
    boolean = _boolean(shape, tool, fuse, glue=False)
    if boolean is None:
        raise OperationError("Boolean operation failed")
    return finished(boolean)

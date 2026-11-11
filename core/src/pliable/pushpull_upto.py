"""Up to face: a pull that adds material from a face or sketch region and ends exactly on a chosen target face.

The distance is not typed. Each profile is extruded along its pull direction to the target's plane. A target parallel to the
profile gives the same prism as a pull of that distance; a tilted target clips the prism, so the pad ends flush on the plane.
"""

from OCP.BRep import BRep_Builder
from OCP.BRepAdaptor import BRepAdaptor_Curve, BRepAdaptor_Surface
from OCP.BRepAlgoAPI import BRepAlgoAPI_Common
from OCP.BRepBuilderAPI import BRepBuilderAPI_MakeFace
from OCP.BRepPrimAPI import BRepPrimAPI_MakeHalfSpace
from OCP.GeomAbs import GeomAbs_Plane
from OCP.TopAbs import TopAbs_COMPOUND, TopAbs_EDGE
from OCP.TopoDS import TopoDS, TopoDS_Compound, TopoDS_Iterator
from OCP.gp import gp_Pnt

from .ops import OperationError, OpResult, _boolean, _contains, _faces_of, _follow, planar_normal, pull_direction, solids_of, unify_result
from .opserrors import MIN_DISTANCE
from .subshapes import sub_shapes
from .pushpull_modes import _prism, compound_of

SAMPLES = 24  # points per boundary edge when finding how far the target plane is from the profile
PARALLEL = 1e-9


def _target_plane(target):
    adaptor = BRepAdaptor_Surface(target)
    if adaptor.GetType() != GeomAbs_Plane:
        raise OperationError("Up to face: the target face must be flat")
    plane = adaptor.Plane()
    return plane.Location(), plane.Axis().Direction()


def _boundary_points(face) -> list:
    points = []
    for edge in sub_shapes(face, TopAbs_EDGE):
        curve = BRepAdaptor_Curve(TopoDS.Edge(edge))
        first, last = curve.FirstParameter(), curve.LastParameter()
        points.extend(curve.Value(first + (last - first) * k / SAMPLES) for k in range(SAMPLES + 1))
    return points


def _reach(face, direction, origin, normal) -> tuple:
    """(nearest, farthest) distance along the pull direction from the profile's boundary to the target plane."""
    pull = pull_direction(planar_normal(face), direction)
    slope = normal.X() * pull.X() + normal.Y() * pull.Y() + normal.Z() * pull.Z()
    if abs(slope) < 1e-6:
        raise OperationError("Up to face: the target face is parallel to the pull direction, so it is never reached")
    steps = [((origin.X() - p.X()) * normal.X() + (origin.Y() - p.Y()) * normal.Y() + (origin.Z() - p.Z()) * normal.Z()) / slope for p in _boundary_points(face)]
    return pull, min(steps), max(steps)


def _clip(prism, face, origin, normal):
    """The part of `prism` on the profile's side of the target plane, and its face on that plane."""
    size = 1e5
    from OCP.gp import gp_Ax3, gp_Dir, gp_Pln

    plane = gp_Pln(gp_Ax3(origin, gp_Dir(normal)))
    sheet = BRepBuilderAPI_MakeFace(plane, -size, size, -size, size).Face()
    inside = _boundary_points(face)[0]
    half = BRepPrimAPI_MakeHalfSpace(sheet, gp_Pnt(inside.X(), inside.Y(), inside.Z())).Solid()
    common = BRepAlgoAPI_Common(prism, half)
    if not common.IsDone() or common.Shape().IsNull():
        raise OperationError("Up to face: could not end the pad on the target face")
    clipped = common.Shape()
    cap = None
    for candidate in _faces_of(clipped):
        adaptor = BRepAdaptor_Surface(TopoDS.Face(candidate))
        if adaptor.GetType() == GeomAbs_Plane and adaptor.Plane().Axis().Direction().IsParallel(normal, 1e-9) and abs(_dist(adaptor.Plane().Location(), origin, normal)) < 1e-6:
            cap = candidate
    return clipped, cap


def _dist(point, origin, normal) -> float:
    return (point.X() - origin.X()) * normal.X() + (point.Y() - origin.Y()) * normal.Y() + (point.Z() - origin.Z()) * normal.Z()


def pull_up_to_face(shape, faces, target, direction, mode: str, preview: bool, flip: bool = False) -> OpResult:
    """Pull `faces` (planar, of a solid or loose sketch regions) up to the `target` face (flat, or curved: see pushpull_curved). Mode "new" adds the pad as a
    separate solid; the role (see `push_role`: Subtract, or Flip in Auto, cuts) fuses it with every body it meets or cuts it from them. Raises OperationError and changes nothing when the
    target is one of the faces, lies behind the pull or cuts through a profile."""
    if any(f.IsSame(target) for f in faces):
        raise OperationError("Up to face: the target is the face being pulled; pick another face")
    flat = BRepAdaptor_Surface(target).GetType() == GeomAbs_Plane
    if flat:
        origin, normal = _target_plane(target)
    pads, caps = [], []
    for face in faces:
        if planar_normal(face) is None:
            raise OperationError("Up to face needs flat faces to pull")
        if not flat:  # a curved target: the pad ends on its surface (see pushpull_curved)
            from .pushpull_curved import pad_to_curved_face

            pad, cap = pad_to_curved_face(shape, face, target, direction)
            pads.append(pad)
            caps.append(cap)
            continue
        pull, near, far = _reach(face, direction, origin, normal)
        if near <= MIN_DISTANCE:
            raise OperationError("Up to face: the target face is behind the pull direction or cuts through the face; pick a face ahead of it")
        straight, cap = _prism(face, pull.Multiplied(far))
        if far - near > 1e-6 * max(1.0, far):  # tilted target: end the prism flush on the plane
            straight, cap = _clip(straight, face, origin, normal)
            if cap is None:
                raise OperationError("Up to face: could not end the pad on the target face")
        pads.append(straight)
        caps.append(cap)
    return assemble_pads(shape, faces, pads, caps, mode, flip, preview)


def assemble_pads(shape, faces, pads, caps, mode: str, flip: bool = False, preview: bool = False) -> OpResult:
    """Put the finished `pads` (solids, each with its end face in `caps`, or None) into `shape`: mode "new" keeps each as a
    separate solid, a cutting role (Subtract, or Flip in Auto) subtracts them from every body they meet (nothing removed: see
    `nothing_to_subtract`), any other fuses them with every body they meet. The pulled `faces` are replaced by the pads."""
    from .pushpull_modes import _volume_of, nothing_to_subtract, push_role

    cut = push_role(mode, flip, 1.0) == "cut"
    solids = solids_of(shape)
    others = [f for f in _faces_of(shape) if not any(f.IsSame(p) for p in faces) and not any(_contains(solid, f) for solid in solids)]
    combined, builder = TopoDS_Compound(), BRep_Builder()
    builder.MakeCompound(combined)
    tracked = [cap for cap in caps if cap is not None]
    if mode == "new":
        if shape.ShapeType() == TopAbs_COMPOUND:  # as new_bodies: everything stays, the pad is added beside it
            it = TopoDS_Iterator(shape)
            while it.More():
                builder.Add(combined, it.Value())
                it.Next()
        else:
            builder.Add(combined, shape)
        for p in pads:
            builder.Add(combined, p)
    elif solids and cut:
        body = compound_of(solids)
        removal = _boolean(body, compound_of(pads), False, glue=False)
        if removal is None:
            raise OperationError("Boolean operation failed")
        if _volume_of(removal.Shape()) >= _volume_of(body) - 1e-6:
            return nothing_to_subtract(shape, faces, pads, preview)
        builder.Add(combined, removal.Shape())
        tracked = [kept for cap in caps if cap is not None for kept in _follow(removal, [cap])]
    elif cut:
        return nothing_to_subtract(shape, faces, pads, preview)
    elif solids:
        fuse = _boolean(compound_of(solids), compound_of(pads), True, glue=False)
        if fuse is None:
            raise OperationError("Boolean operation failed")
        builder.Add(combined, fuse.Shape())
        tracked = [kept for cap in caps if cap is not None for kept in _follow(fuse, [cap])]
    else:
        for p in pads:
            builder.Add(combined, p)
    if mode != "new":
        for f in others:
            builder.Add(combined, f)
    return unify_result(OpResult(combined, tracked))

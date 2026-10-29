"""The Push/Pull tool."""

from ..ops import face_handle_point, MIN_DISTANCE, OperationError, OpResult, planar_normal, pull_direction, push_pull
from ..pushpull_modes import MODES
from ..symmetric import symmetric_faces
from .base import Accepts, Handle, Param, register, Tool


@register
class PushPull(Tool):
    id = "push_pull"
    label = "Push/Pull"
    description = "Moves flat faces in or out along their normal, adding or removing material. Select one or more flat faces, then drag or type a distance. Hold Shift while dragging to push/pull symmetrically: a sketch face about its plane, two parallel faces about their mid-plane, or one face with its mirror counterpart about the origin plane or a datum plane. Alt+click cycles through faces under the cursor."
    accepts = Accepts(faces=(1, None))
    params = [Param("distance", "length", drag=True)]
    related = ("coplanar", "parallel")

    def bind(self, raw):
        values = super().bind(raw)
        values["symmetric"] = 1.0 if raw.get("symmetric") else 0.0  # set by a Shift drag; not a form field
        mode = raw.get("mode", "auto")  # "auto", "add", "subtract" or "new" (not a form field)
        if mode not in MODES:
            raise OperationError(f"Push/pull mode must be one of {', '.join(MODES)}")
        values["mode"] = mode
        values["flip"] = 1.0 if raw.get("flip") else 0.0  # reverses which drag direction adds and which subtracts
        # A chosen pull direction (not a form field): unit components, all three or none.
        if all(k in raw for k in ("ux", "uy", "uz")):
            values.update({k: float(raw[k]) for k in ("ux", "uy", "uz")})
        return values

    def handles(self, topology, selection, values):
        if _all_round_walls(topology, selection):
            return []  # a hole wall is dragged along its radius in the view
        face = topology.face(selection.faces[0])
        normal = planar_normal(face)
        if normal is None:
            return []
        point = face_handle_point(face)
        distance = values["distance"]
        try:
            pull = pull_direction(normal, _chosen(values))
        except OperationError:
            pull = pull_direction(normal)  # a direction along the face: the run reports it, the arrow stays on the normal
        from ..sketch.planes import face_plane, frame

        _, x_axis, y_axis, _ = frame(face_plane(face))  # the axes a sketch on this face would use
        return [Handle("distance", "Push/pull", (point.X() + pull.X() * distance, point.Y() + pull.Y() * distance, point.Z() + pull.Z() * distance), (pull.X(), pull.Y(), pull.Z()), frame=(x_axis, y_axis))]

    def applies(self, topology, selection):
        if _all_round_walls(topology, selection):
            return True
        normals = [planar_normal(topology.face(i)) for i in selection.faces]
        if len(normals) == 2 and all(n is not None for n in normals) and normals[0].IsOpposite(normals[1], 1e-6):
            return True  # two parallel faces facing away from each other: only a symmetric push/pull moves them (see run)
        return all(n is not None for n in normals) and all(n.IsParallel(normals[0], 1e-6) and not n.IsOpposite(normals[0], 1e-6) for n in normals)

    def run(self, topology, selection, values, preview):
        if _all_round_walls(topology, selection):
            return _push_round_walls(topology, selection, values["distance"])
        faces = [topology.face(i) for i in selection.faces]
        symmetric = values["symmetric"] >= 0.5
        loose = not any(_in_solid(topology.shape, f) for f in faces)
        if symmetric and not loose:
            faces = symmetric_faces(topology, faces, getattr(topology, "datums", []))
        elif len(faces) == 2 and planar_normal(faces[0]).IsOpposite(planar_normal(faces[1]), 1e-6):
            raise OperationError("These two faces face away from each other; hold Shift while dragging to push/pull them symmetrically")
        direction = _chosen(values)
        if direction is not None and symmetric:
            raise OperationError("Symmetric push/pull uses the face normal; reset the pull direction first")
        result = push_pull(topology.shape, faces if len(faces) > 1 else faces[0], values["distance"], preview=preview, symmetric=symmetric and loose, direction=direction, mode=values["mode"], flip=values["flip"] >= 0.5)
        result.tracked_faces = result.tracked_faces[:1]  # keep a single face selected, the related ones are found again
        return result


def _chosen(values):
    """The pull direction picked by the user as (x, y, z), or None for the face normal."""
    return (values["ux"], values["uy"], values["uz"]) if "ux" in values else None


def _in_solid(shape, face) -> bool:
    from ..ops import _contains, solids_of

    return any(_contains(solid, face) for solid in solids_of(shape))


def _all_round_walls(topology, selection) -> bool:
    """True when every selected face is a whole cylinder wall (a hole or a boss)."""
    from OCP.BRepAdaptor import BRepAdaptor_Surface
    from OCP.BRepTools import BRepTools
    from OCP.GeomAbs import GeomAbs_Cylinder
    import math

    from ..splitwalls import wall_chain

    for i in selection.faces:
        face = topology.face(i)
        if BRepAdaptor_Surface(face).GetType() != GeomAbs_Cylinder:
            return False
        u0, u1, _, _ = BRepTools.UVBounds_s(face)
        if u1 - u0 < 2 * math.pi - 1e-6 and not wall_chain(topology, i):  # a wall split into several faces still counts
            return False
    return True


def _push_round_walls(topology, selection, distance: float) -> OpResult:
    """Push/pull on a hole or boss wall moves the wall along its normal: a hole shrinks when the wall is pushed
    toward the axis (material added) and a boss grows when pulled outward, so the radius changes by `distance`."""
    from ..shared.hole_groups import Hole, apply_holes
    from ..shared.solids import finish

    holes = Hole.of_selection(topology, selection)
    moves = []
    for hole in holes:
        radius = hole.radius + distance if hole.boss else hole.radius - distance
        if radius < MIN_DISTANCE:
            raise OperationError("That would close the hole completely; use a smaller distance")
        moves.append((radius, None))
    return finish(apply_holes(topology.shape, holes, moves))

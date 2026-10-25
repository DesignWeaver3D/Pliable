"""The Center between faces tool."""

from OCP.BRepAdaptor import BRepAdaptor_Surface
from OCP.BRepBndLib import BRepBndLib
from OCP.Bnd import Bnd_Box
from OCP.GeomAbs import GeomAbs_Cylinder
from OCP.gp import gp_Dir, gp_Pnt, gp_Vec

from ..ops import MIN_DISTANCE, OperationError, OpResult, planar_normal
from ..shared.hole_groups import apply_holes, Hole
from ..shared.solids import finish
from ..tools import Accepts, register, Tool


def _plane_offset(face, normal: gp_Dir) -> float:
    return gp_Vec(gp_Pnt(0, 0, 0), BRepAdaptor_Surface(face).Plane().Location()).Dot(gp_Vec(normal))


def _opposite_flat(topology, flat, hole: "Hole"):
    """The nearest flat face of the same solid that faces `flat` across the hole (parallel, opposite outward
    normal, on the inner side, and covering the hole's middle), or None."""
    normal = planar_normal(flat)
    middle = hole.origin.Translated(gp_Vec(hole.direction).Multiplied(hole.length / 2))
    here = _plane_offset(flat, normal)
    best = None
    for _, face in topology.faces():
        other = planar_normal(face)
        if other is None or face.IsSame(flat) or other.Dot(normal) > -1 + 1e-6:
            continue
        gap = here - _plane_offset(face, other.Reversed())  # distance from `flat` inward to this face
        if gap < MIN_DISTANCE:
            continue
        box = Bnd_Box()
        BRepBndLib.Add_s(face, box)
        lo, hi = box.CornerMin(), box.CornerMax()
        inside = all(
            low - 1e-6 <= c <= high + 1e-6
            for c, low, high, along in zip(
                (middle.X(), middle.Y(), middle.Z()), (lo.X(), lo.Y(), lo.Z()), (hi.X(), hi.Y(), hi.Z()), (abs(normal.X()), abs(normal.Y()), abs(normal.Z()))
            )
            if along < 1 - 1e-6
        )
        if inside and (best is None or gap < best[0]):
            best = (gap, face)
    return best[1] if best else None


@register
class CenterBetween(Tool):
    """Centre a hole or boss between two parallel flat faces; the three faces can be picked in any order. With only
    one flat face picked, the nearest flat face facing it across the hole is used (so only one side needs to be seen)."""

    id = "center_between"
    label = "Center between faces"
    description = "Centers a hole or boss between two parallel flat faces. Select the round face and the two flat faces, in any order; or the round face and one flat face, and the opposite side is found for you."
    accepts = Accepts(faces=(2, 3))

    @staticmethod
    def _sorted(topology, selection):
        """(hole, flat, flat or None) from the picked faces: one cylinder plus one or two planes, or None."""
        faces = [topology.face(i) for i in selection.faces]
        holes = [f for f in faces if BRepAdaptor_Surface(f).GetType() == GeomAbs_Cylinder]
        flats = [f for f in faces if planar_normal(f) is not None]
        if len(holes) != 1 or len(flats) != len(faces) - 1:
            return None
        return holes[0], flats[0], (flats[1] if len(flats) == 2 else None)

    def applies(self, topology, selection):
        found = self._sorted(topology, selection)
        if found is None:
            return False
        if found[2] is None:
            return True
        na, nb = planar_normal(found[1]), planar_normal(found[2])
        return abs(na.Dot(nb)) > 1 - 1e-6

    def run(self, topology, selection, values, preview):
        found = self._sorted(topology, selection)
        if found is None:
            raise OperationError("Select one hole or boss and one or two flat faces")
        hole_face, a, b = found
        hole = Hole(hole_face)
        if b is None:
            b = _opposite_flat(topology, a, hole)
            if b is None:
                raise OperationError("No flat face faces that one across the hole; pick the second face yourself")
        normal = planar_normal(a)
        axis_along = abs(hole.direction.Dot(normal))
        if axis_along > 1 - 1e-6:
            raise OperationError("The hole runs along the faces' normal, so it cannot be centred between them")
        offsets = [_plane_offset(f, normal) for f in (a, b)]
        middle = hole.origin.Translated(gp_Vec(hole.direction).Multiplied(hole.length / 2))
        here = gp_Vec(gp_Pnt(0, 0, 0), middle).Dot(gp_Vec(normal))
        delta = (offsets[0] + offsets[1]) / 2 - here
        if abs(delta) < MIN_DISTANCE:
            return OpResult(topology.shape, [])
        move = gp_Vec(normal).Multiplied(delta)
        return finish(apply_holes(topology.shape, [hole], [(None, move)]))

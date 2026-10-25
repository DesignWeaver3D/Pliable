"""The Move hole / boss tool."""

from OCP.gp import gp_Vec

from ..ops import MIN_DISTANCE, OpResult
from ..shared.hole_groups import _CylinderFaces, _holes, apply_holes
from ..shared.solids import finish
from ..tools import Accepts, Param, register


@register
class MoveHole(_CylinderFaces):
    id = "move_hole"
    label = "Move hole / boss"
    description = "Moves a hole or boss by the given distances along X, Y and Z. Select its round face."
    related = ("equal_radius",)
    accepts = Accepts(faces=(1, None))
    params = [Param("dx", "length"), Param("dy", "length"), Param("dz", "length")]
    move_vector = ("dx", "dy", "dz")

    def run(self, topology, selection, values, preview):
        offset = gp_Vec(values["dx"], values["dy"], values["dz"])
        shape = topology.shape
        if offset.Magnitude() < MIN_DISTANCE:
            return OpResult(shape, [topology.face(i) for i in selection.faces])
        from ..holes import follow_cylinder

        holes = _holes(topology, selection)
        result = finish(apply_holes(shape, holes, [(None, offset)] * len(holes)))
        for i in selection.faces:
            result.tracked_faces += follow_cylinder(result.shape, topology.face(i), offset)
        return result

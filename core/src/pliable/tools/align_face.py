"""The Align face tool."""

from OCP.gp import gp_Vec

from ..ops import OperationError, push_pull
from ..shared.faces import _PlanarFace, _plane_axes
from ..tools import Accepts, Param, register


@register
class AlignFace(_PlanarFace):
    """Move the first selected flat face until it is flush with the second (parallel faces only)."""

    id = "align_face"
    label = "Align face"
    description = "Moves the first selected flat face until it is flush with the second, plus an optional offset. Needs exactly two parallel flat faces selected, the one to move first; it stays unavailable until both are selected."
    accepts = Accepts(faces=(2, 2))
    params = [Param("offset", "length")]

    def run(self, topology, selection, values, preview):
        moving, target = (topology.face(i) for i in selection.faces)
        point, normal, _, _ = _plane_axes(moving)
        goal, goal_normal, _, _ = _plane_axes(target)
        if abs(normal.Dot(goal_normal)) < 1 - 1e-6:
            raise OperationError("The two faces must be parallel")
        distance = gp_Vec(point, goal).Dot(gp_Vec(normal)) + values["offset"]
        return push_pull(topology.shape, moving, distance, preview=preview)

"""The Resize hole / boss tool."""

from ..ops import MIN_DISTANCE, OperationError, OpResult
from ..shared.hole_groups import _CylinderFaces, _holes, apply_holes
from ..shared.solids import finish
from ..tools import Accepts, Param, register


@register
class ResizeHole(_CylinderFaces):
    """Change a hole's diameter, keeping its axis and depth. A diameter of 0 leaves it unchanged."""

    id = "resize_hole"
    label = "Resize hole / boss"
    description = "Changes the diameter of a hole or boss, keeping its axis and depth. Select its round face; a diameter of 0 leaves it unchanged."
    related = ("equal_radius",)
    accepts = Accepts(faces=(1, None))
    params = [Param("diameter", "length", 0.0)]

    def run(self, topology, selection, values, preview):
        diameter = values["diameter"]
        if diameter < 0:
            raise OperationError("The diameter can't be negative")
        shape = topology.shape
        if diameter < MIN_DISTANCE:
            return OpResult(shape, [topology.face(i) for i in selection.faces])
        holes = _holes(topology, selection)
        return finish(apply_holes(shape, holes, [(diameter / 2, None)] * len(holes)))

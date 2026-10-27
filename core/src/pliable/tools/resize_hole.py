"""The Resize hole / boss tool."""

from ..ops import MIN_DISTANCE, OperationError, OpResult
from ..shared.hole_groups import _CylinderFaces, _holes, apply_holes
from ..shared.solids import finish
from ..shared.hole_edit import _perpendicular
from ..tools import Accepts, Param, register, round_handles


@register
class ResizeHole(_CylinderFaces):
    """Change a hole's diameter, keeping its axis and depth. A diameter of 0 leaves it unchanged."""

    id = "resize_hole"
    label = "Resize hole / boss"
    description = "Changes the diameter of a hole or boss, keeping its axis and depth. Select its round face; a diameter of 0 leaves it unchanged."
    related = ("equal_radius",)
    accepts = Accepts(faces=(1, None))
    params = [Param("diameter", "length", 0.0)]

    def handles(self, topology, selection, values):
        # The same radius and diameter grips as Edit hole, on the first selected hole or boss at its opening; 0 shows the current size.
        try:
            hole = _holes(topology, selection)[0]
        except OperationError:
            return []
        axis = (hole.direction.X(), hole.direction.Y(), hole.direction.Z())
        across = [i for i in range(3) if abs(axis[i]) < 0.5]
        if not across:
            return []
        unit = tuple(1.0 if k == across[0] else 0.0 for k in range(3))
        diameter = values["diameter"] if values["diameter"] >= MIN_DISTANCE else 2 * hole.radius
        centre = (hole.origin.X(), hole.origin.Y(), hole.origin.Z())
        return round_handles("diameter", "Hole" if not hole.boss else "Boss", centre, unit, _perpendicular(axis, unit), diameter, min=MIN_DISTANCE, shown=diameter)

    def run(self, topology, selection, values, preview):
        diameter = values["diameter"]
        if diameter < 0:
            raise OperationError("The diameter can't be negative")
        shape = topology.shape
        if diameter < MIN_DISTANCE:
            return OpResult(shape, [topology.face(i) for i in selection.faces])
        holes = _holes(topology, selection)
        return finish(apply_holes(shape, holes, [(diameter / 2, None)] * len(holes)))

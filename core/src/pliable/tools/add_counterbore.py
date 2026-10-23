"""The Add counterbore tool."""

from OCP.gp import gp_Vec

from ..ops import MIN_DISTANCE, OperationError
from ..shared.hole_groups import _HoleOnFace
from ..shared.solids import _cylinder
from ..tools import Param, register


@register
class AddCounterbore(_HoleOnFace):
    """A hole with a wider, flat-bottomed recess at the top (for socket-head screws)."""

    id = "add_counterbore"
    label = "Add counterbore"
    description = "Drills a stepped hole with a wider, flat-bottomed top part for a screw head. Select one flat face; depth 0 = through."
    params = _HoleOnFace.params + [Param("bore_diameter", "length", 11), Param("bore_depth", "length", 4)]

    def extra_cutters(self, start, normal, values, depth, margin):
        if values["bore_diameter"] <= values["diameter"] or values["bore_depth"] < MIN_DISTANCE:
            raise OperationError("The counterbore must be wider than the hole and have a depth")
        lead = start.Translated(gp_Vec(normal).Multiplied(margin))
        return [_cylinder(lead, normal.Reversed(), values["bore_diameter"] / 2, values["bore_depth"] + margin)]

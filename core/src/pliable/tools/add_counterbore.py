"""The Add counterbore tool."""

from OCP.gp import gp_Vec

from ..ops import MIN_DISTANCE, OperationError
from ..shared.hole_edit import _entered_diameter, SIZE_BY
from ..shared.hole_groups import _HoleOnFace
from ..shared.solids import _cylinder
from ..tools import Param, register


@register
class AddCounterbore(_HoleOnFace):
    """A hole with a wider, flat-bottomed recess at the top (for socket-head screws)."""

    id = "add_counterbore"
    label = "Add counterbore"
    description = "Drills a stepped hole with a wider, flat-bottomed top part for a screw head. Select one flat face; depth 0 = through."
    params = _HoleOnFace.params + [Param("bore_by", "number", 0, options=SIZE_BY), Param("bore_diameter", "length", 11), Param("bore_offset", "length", 2.5), Param("bore_depth", "length", 4)]

    def extra_cutters(self, start, normal, values, depth, margin):
        wide = _entered_diameter(values, "bore_by", "bore_diameter", "bore_offset", values["diameter"])
        if wide <= values["diameter"] or values["bore_depth"] < MIN_DISTANCE:
            raise OperationError("The counterbore must be wider than the hole and have a depth")
        lead = start.Translated(gp_Vec(normal).Multiplied(margin))
        return [_cylinder(lead, normal.Reversed(), wide / 2, values["bore_depth"] + margin)]

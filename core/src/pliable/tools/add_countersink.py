"""The Add countersink tool."""

import math

from OCP.BRepPrimAPI import BRepPrimAPI_MakeCone
from OCP.gp import gp_Ax2, gp_Vec

from ..ops import OperationError
from ..shared.hole_edit import _entered_diameter, SIZE_BY
from ..shared.hole_groups import _HoleOnFace
from ..tools import Param, register


@register
class AddCountersink(_HoleOnFace):
    """A hole with a conical recess at the top (for flat-head screws); the cone angle is the full included angle."""

    id = "add_countersink"
    label = "Add countersink"
    description = "Drills a hole with a cone-shaped opening for a flat-head screw. Select one flat face; depth 0 = through."
    params = _HoleOnFace.params + [Param("sink_by", "number", 0, options=SIZE_BY), Param("sink_diameter", "length", 12), Param("sink_offset", "length", 3), Param("sink_angle", "angle", 90)]

    def extra_cutters(self, start, normal, values, depth, margin):
        sink = _entered_diameter(values, "sink_by", "sink_diameter", "sink_offset", values["diameter"])
        if sink <= values["diameter"] or not 10 <= values["sink_angle"] <= 170:
            raise OperationError("The countersink must be wider than the hole, with an angle between 10 and 170 degrees")
        half = math.radians(values["sink_angle"]) / 2
        r_top, r_bottom = sink / 2, values["diameter"] / 2
        height = (r_top - r_bottom) / math.tan(half)
        # Cone from the hole's radius at depth `height` up to the sink radius at the face, extended by the margin.
        r_lead = r_top + margin * math.tan(half)
        base = start.Translated(gp_Vec(normal).Multiplied(-height))
        return [BRepPrimAPI_MakeCone(gp_Ax2(base, normal), r_bottom, r_lead, height + margin).Shape()]

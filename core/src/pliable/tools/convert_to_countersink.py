"""The Add countersink to hole tool."""

import math

from ..holes import rebuild_hole
from ..ops import MIN_DISTANCE, OperationError
from ..shared.hole_edit import _check_room, _end_changes, _HoleTool, _perpendicular, CLEARANCE
from ..shared.solids import finish
from ..tools import Param, register, round_handles


@register
class ConvertToCountersink(_HoleTool):
    """Cut a cone-shaped opening into an existing hole, given by its diameter at the surface and its included angle."""

    id = "convert_to_countersink"
    label = "Add countersink to hole"
    description = (
        "Adds a countersink to an existing round hole: turns its opening into a cone for a flat-head screw, set by the cone's diameter at the surface and its included angle. "
        "Select a face of the hole or the circle at its opening. End 0 is the opening, end 1 the far end of a through hole. This is not the same as an edge chamfer, which is a plain edge break."
    )
    params = [Param("sink_diameter", "length", 12), Param("sink_angle", "angle", 90), Param("end", "number", 0)]

    def run(self, topology, selection, values, preview):
        info = self.hole(topology, selection)
        sink, angle = values["sink_diameter"], values["sink_angle"]
        if sink <= info.diameter + MIN_DISTANCE or not 10 <= angle <= 170:
            raise OperationError("The countersink must be wider than the hole, with an angle between 10 and 170 degrees")
        height = (sink - info.diameter) / 2 / math.tan(math.radians(angle) / 2)
        far = values["end"] >= 0.5
        _check_room(info, height, far)
        if any(s["type"] == "counterbore" for s in (info.end_stages if far else info.stages)):
            raise OperationError("This end of the hole has a counterbore; a countersink can't be added to it")
        stage = {"type": "countersink", "diameter": sink, "angle": angle, "depth": height}
        return finish(rebuild_hole(topology.shape, info, None, **_end_changes(info, stage, far)))

    def handles(self, topology, selection, values):
        info = self.hole(topology, selection)
        axis = (info.direction.X(), info.direction.Y(), info.direction.Z())
        across = [i for i in range(3) if abs(axis[i]) < 0.5]
        if not across:
            return []
        unit = tuple(1.0 if k == across[0] else 0.0 for k in range(3))
        rim = info.point(info.depth if values["end"] >= 0.5 and info.through else 0.0)
        return round_handles("sink_diameter", "Countersink", (rim.X(), rim.Y(), rim.Z()), unit, _perpendicular(axis, unit), values["sink_diameter"], min=info.diameter + 10 * CLEARANCE)

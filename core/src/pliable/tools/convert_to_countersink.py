"""The Add countersink to hole tool."""

import math

from ..holes import rebuild_hole
from ..ops import MIN_DISTANCE, OperationError
from ..shared.hole_edit import _check_room, _end_changes, _entered_diameter, _HoleTool, _perpendicular, CLEARANCE, SIZE_BY
from ..shared.solids import finish
from ..tools import Handle, Param, register, round_handles


@register
class ConvertToCountersink(_HoleTool):
    """Cut a cone-shaped opening into an existing hole, given by its diameter at the surface and its included angle."""

    id = "convert_to_countersink"
    label = "Add countersink to hole"
    description = (
        "Adds a countersink to an existing round hole: turns its opening into a cone for a flat-head screw, set by the cone's diameter at the surface and its included angle. "
        "Select a face of the hole or the circle at its opening. End 0 is the opening, end 1 the far end of a through hole. This is not the same as an edge chamfer, which is a plain edge break."
    )
    params = [Param("sink_by", "number", 0, options=SIZE_BY), Param("sink_diameter", "length", 12), Param("sink_offset", "length", 3), Param("sink_angle", "angle", 90), Param("end", "number", 0)]

    def run(self, topology, selection, values, preview):
        info = self.hole(topology, selection)
        sink, angle = _entered_diameter(values, "sink_by", "sink_diameter", "sink_offset", info.diameter), values["sink_angle"]
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
        centre = (rim.X(), rim.Y(), rim.Z())
        sink = _entered_diameter(values, "sink_by", "sink_diameter", "sink_offset", info.diameter)
        perpendicular = _perpendicular(axis, unit)
        if int(round(values["sink_by"])) == 1:
            reach = tuple(c + unit[k] * sink / 2 for k, c in enumerate(centre))
            out = [Handle("sink_offset", "Countersink offset", reach, unit, min=10 * CLEARANCE)]
        else:
            out = round_handles("sink_diameter", "Countersink", centre, unit, perpendicular, values["sink_diameter"], min=info.diameter + 10 * CLEARANCE)
        # The angle: an arc swung about the point where the cone meets the face (the mouth stays put when the angle changes), carried on the cone's side line.
        angle = values["sink_angle"]
        if 10 <= angle <= 170 and sink > info.diameter:
            half = math.radians(angle) / 2
            inward = axis if values["end"] < 0.5 else tuple(-c for c in axis)  # into the material from the opening being worked on
            mouth = tuple(c + unit[k] * sink / 2 for k, c in enumerate(centre))
            reach = max((sink - info.diameter) / 2 / math.sin(half), 4.0)  # the side line's own length, so the grip sits at the cone's foot
            side = tuple(-math.sin(half) * unit[k] + math.cos(half) * inward[k] for k in range(3))
            grip = tuple(mouth[k] + reach * side[k] for k in range(3))
            tangent = tuple(-math.cos(half) * unit[k] - math.sin(half) * inward[k] for k in range(3))
            out.append(Handle("sink_angle", "Countersink angle", grip, tangent, scale=2 * math.degrees(1 / reach), min=10.0, max=170.0, unit="°", axis=perpendicular, ring=(*mouth, reach), arc=True))
        return out

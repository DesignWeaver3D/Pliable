"""The Add counterbore to hole tool."""

from ..holes import rebuild_hole
from ..ops import MIN_DISTANCE, OperationError
from ..shared.hole_edit import _check_room, _end_changes, _HoleTool, _perpendicular, CLEARANCE
from ..shared.solids import finish
from ..tools import Param, register, round_handles


@register
class ConvertToCounterbore(_HoleTool):
    """Widen the top of an existing hole into a flat-bottomed step for a bolt head, at either end of a through hole."""

    id = "convert_to_counterbore"
    label = "Add counterbore to hole"
    description = (
        "Adds a counterbore to an existing round hole: widens its opening into a flat-bottomed step for a bolt head, set by the step's diameter and depth. "
        "Select a face of the hole or the circle at its opening. End 0 is the opening, end 1 the far end of a through hole."
    )
    params = [Param("bore_diameter", "length", 12), Param("bore_depth", "length", 4), Param("end", "number", 0)]

    def run(self, topology, selection, values, preview):
        info = self.hole(topology, selection)
        wide, depth = values["bore_diameter"], values["bore_depth"]
        if wide <= info.diameter + MIN_DISTANCE or depth < MIN_DISTANCE:
            raise OperationError("The counterbore must be wider than the hole and have a depth")
        far = values["end"] >= 0.5
        _check_room(info, depth, far)
        if any(s["type"] == "countersink" for s in (info.end_stages if far else info.stages)):
            raise OperationError("This end of the hole has a countersink; a counterbore can't be added to it")
        stage = {"type": "counterbore", "diameter": wide, "depth": depth}
        return finish(rebuild_hole(topology.shape, info, None, **_end_changes(info, stage, far)))

    def handles(self, topology, selection, values):
        info = self.hole(topology, selection)
        axis = (info.direction.X(), info.direction.Y(), info.direction.Z())
        across = [i for i in range(3) if abs(axis[i]) < 0.5]
        if not across:
            return []
        unit = tuple(1.0 if k == across[0] else 0.0 for k in range(3))
        rim = info.point(info.depth if values["end"] >= 0.5 and info.through else 0.0)
        return round_handles("bore_diameter", "Counterbore", (rim.X(), rim.Y(), rim.Z()), unit, _perpendicular(axis, unit), values["bore_diameter"], min=info.diameter + 10 * CLEARANCE)

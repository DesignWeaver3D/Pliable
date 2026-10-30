"""The base class and helpers of the tools that edit a round hole as a whole."""

import math

from ..holes import find_hole, follow_cylinder, HoleInfo, NOT_ROUND
from ..ops import OperationError
from ..tools import Accepts, Tool


CLEARANCE = 1e-3  # how far past a counterbore or countersink the bore must still reach


def _target(selection) -> dict:
    if selection.faces:
        return {"face_id": selection.faces[0]}
    return {"edge_id": selection.edges[0]}


class _HoleTool(Tool):
    """Shared selection handling: one face of a hole, or one circular edge at its opening."""

    accepts = Accepts(faces=(0, 1), edges=(0, 1), any_of=True)

    def applies(self, topology, selection):
        if len(selection.faces) + len(selection.edges) != 1:
            return False
        try:
            find_hole(topology, reach=False, **_target(selection))
        except OperationError:
            return False
        return True

    def refusal(self, topology, selection):
        return NOT_ROUND if self.accepts.matches(selection) else None

    def hole(self, topology, selection, reach: bool = True) -> HoleInfo:
        if len(selection.faces) + len(selection.edges) != 1:
            raise OperationError("Select one face of a hole, or the circle at its opening")
        return find_hole(topology, reach=reach, **_target(selection))


SIZE_BY = ("Diameter", "Offset from hole")  # how a counterbore or countersink size is entered: its own diameter, or how far it reaches past the hole's wall


def _entered_diameter(values, by: str, diameter_key: str, offset_key: str, hole_diameter: float) -> float:
    """The counterbore or countersink diameter: the typed diameter, or the hole's diameter plus twice the typed offset, as `by` chooses (0 diameter, 1 offset)."""
    if int(round(values.get(by, 0))) == 1:
        return hole_diameter + 2 * values[offset_key]
    return values[diameter_key]


def _perpendicular(axis, unit) -> tuple[float, float, float]:
    """The unit direction across the hole at right angles to `unit` (axis cross unit)."""
    c = (axis[1] * unit[2] - axis[2] * unit[1], axis[2] * unit[0] - axis[0] * unit[2], axis[0] * unit[1] - axis[1] * unit[0])
    n = math.sqrt(sum(v * v for v in c)) or 1.0
    return tuple(v / n for v in c)


def _end_changes(info: HoleInfo, stage: dict, far: bool) -> dict:
    """The rebuild changes that put `stage` at the opening or, with `far`, at the far end of a through hole."""
    if not far:
        return {"stages": [stage]}
    if not info.through:
        raise OperationError("Only a hole that goes through has a far end; the other end of this one is its bottom")
    return {"end_stages": [stage]}


def _check_room(info: HoleInfo, depth: float, far: bool) -> None:
    """The new stage must leave some bore between it and the stage at the other end."""
    other = max((s["depth"] for s in (info.end_stages if not far else info.stages)), default=0.0)
    if depth + other >= info.depth - CLEARANCE:
        raise OperationError("The countersink or counterbore is deeper than the hole allows; use a smaller depth" if not other else "The two ends would meet; use a smaller depth at one of them")


def _keep_bore(result, topology, info: HoleInfo):
    """Keep the hole's bore selected after a change that leaves it where it was (so the Hole Editor stays open on the hole)."""
    for i in info.faces:
        result.tracked_faces += follow_cylinder(result.shape, topology.face(i), None, only_radius=info.diameter / 2)
    return result

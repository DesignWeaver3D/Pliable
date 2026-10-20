"""Tools that edit a round hole as a whole: size, depth and position together (`edit_hole`), and turning a hole's
opening, or the far end of a through hole, into a countersink or counterbore (`convert_to_countersink`, `convert_to_counterbore`). All work from any face of the hole or its rim edge, using the
hole description in holes.py.

The hole's on-screen gizmo is its axis: a line from the opening to the end of the bore, with a grip at each end of the bore (the far one sets the depth, the end of its range is "through"; the entry one sets where
the bore starts below the face), a grip on the rim that sets the diameter, and move arrows at the
middle that move the hole across the face.
"""

import math

from OCP.gp import gp_Vec

from .features import finish
from .holes import NOT_ROUND, HoleInfo, find_hole, follow_cylinder, rebuild_hole
from .ops import MIN_DISTANCE, OperationError, OpResult
from .tools import Accepts, Handle, Param, Tool, register, round_handles

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


def _perpendicular(axis, unit) -> tuple[float, float, float]:
    """The unit direction across the hole at right angles to `unit` (axis cross unit)."""
    c = (axis[1] * unit[2] - axis[2] * unit[1], axis[2] * unit[0] - axis[0] * unit[2], axis[0] * unit[1] - axis[1] * unit[0])
    n = math.sqrt(sum(v * v for v in c)) or 1.0
    return tuple(v / n for v in c)


@register
class EditHole(_HoleTool):
    """Change a hole's diameter, depth and position in one step. 0 leaves a size unchanged."""

    id = "edit_hole"
    label = "Edit hole"
    description = (
        "Changes a round hole's diameter or depth and moves it, keeping counterbore or countersink steps. "
        "Select a face of the hole or the circle at its opening; 0 leaves a size unchanged, and a depth as long as the body is through."
    )
    params = [Param("diameter", "length", 0.0), Param("depth", "length", 0.0), Param("start", "length", 0.0), Param("dx", "length"), Param("dy", "length"), Param("dz", "length")]
    move_vector = ("dx", "dy", "dz")

    def run(self, topology, selection, values, preview):
        info = self.hole(topology, selection)
        diameter, depth = values["diameter"], values["depth"]
        if diameter < 0 or depth < 0:
            raise OperationError("The diameter and depth can't be negative")
        offset = gp_Vec(values["dx"], values["dy"], values["dz"])
        changes: dict = {}
        if diameter >= MIN_DISTANCE and abs(diameter - info.diameter) > MIN_DISTANCE:
            widest = min((s["diameter"] for s in info.stages + info.end_stages), default=math.inf)
            if diameter >= widest - CLEARANCE:
                raise OperationError("The hole must stay narrower than its counterbore or countersink; change that first")
            changes["diameter"] = diameter
        if depth >= MIN_DISTANCE:
            if depth >= info.pass_length - MIN_DISTANCE:
                if not info.through:
                    changes.update(through=True, depth=info.pass_length)
            elif abs(depth - info.depth) > MIN_DISTANCE or info.through:
                deepest = max((s["depth"] for s in info.stages), default=0.0)
                if depth <= deepest + CLEARANCE:
                    raise OperationError("The depth must go past the counterbore or countersink")
                changes.update(through=False, depth=depth)
        start = values["start"]
        if start < 0:
            raise OperationError("The start of the bore can't be negative")
        if start >= MIN_DISTANCE:
            end = changes.get("depth", info.pass_length if info.through else info.depth)
            if start > end - 10 * CLEARANCE:
                raise OperationError("The bore must start before its end")
            changes["start"] = start
        if offset.Magnitude() < MIN_DISTANCE and not changes:
            return OpResult(topology.shape, [topology.face(i) for i in info.faces])
        move = offset if offset.Magnitude() >= MIN_DISTANCE else None
        result = finish(rebuild_hole(topology.shape, info, move, **changes))
        # Keep the bore selected: the page measures the moved hole from it.
        for i in info.faces:
            result.tracked_faces += follow_cylinder(result.shape, topology.face(i), move, changes.get("diameter"), only_radius=info.diameter / 2)
        return result

    def handles(self, topology, selection, values):
        info = self.hole(topology, selection)
        diameter = values["diameter"] if values["diameter"] >= MIN_DISTANCE else info.diameter
        depth = values["depth"] if values["depth"] >= MIN_DISTANCE else (info.pass_length if info.through else info.depth)
        shift = (values["dx"], values["dy"], values["dz"])
        axis = (info.direction.X(), info.direction.Y(), info.direction.Z())

        def at(s: float) -> tuple[float, float, float]:
            p = info.point(s)
            return (p.X() + shift[0], p.Y() + shift[1], p.Z() + shift[2])

        # The two model axes that run across the hole move it in its plane; one across-direction carries the diameter grip.
        across = [i for i in range(3) if abs(axis[i]) < 0.5]
        deepest = max((s["depth"] for s in info.stages), default=0.0)
        end = min(depth, info.pass_length)
        start = min(max(values["start"], 0.0), end - 10 * CLEARANCE)
        out = [
            Handle("depth", "Hole depth (end = through)", at(end), axis, min=max(deepest, start) + 10 * CLEARANCE, max=info.pass_length, kind="resize", shown=end, axis_from=at(0.0)),
            Handle("start", "Hole start (entry end)", at(start), axis, min=0.0, max=end - 10 * CLEARANCE, kind="resize", shown=start),
        ]
        if across:
            unit = tuple(1.0 if k == across[0] else 0.0 for k in range(3))
            rim = info.point(0.0)
            centre = (rim.X() + shift[0], rim.Y() + shift[1], rim.Z() + shift[2])
            widest = min((s["diameter"] for s in info.stages + info.end_stages), default=math.inf)
            out.extend(round_handles("diameter", "Hole", centre, unit, _perpendicular(axis, unit), diameter, min=MIN_DISTANCE, max=None if math.isinf(widest) else widest - CLEARANCE, shown=diameter))
        middle = at(end / 2)
        names = ("dx", "dy", "dz")
        for i in across:
            direction = tuple(1.0 if k == i else 0.0 for k in range(3))
            out.append(Handle(names[i], f"Move along {'XYZ'[i]}", middle, direction, kind="move"))
        return out


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


__all__ = ["EditHole", "ConvertToCountersink", "ConvertToCounterbore", "NOT_ROUND"]

"""The Edit hole tool."""

import math

from OCP.gp import gp_Vec

from ..holes import follow_cylinder, rebuild_hole
from ..ops import MIN_DISTANCE, OperationError, OpResult
from ..shared.hole_edit import _HoleTool, _perpendicular, CLEARANCE
from ..shared.solids import finish
from ..tools import Handle, Param, register, round_handles


@register
class EditHole(_HoleTool):
    """Change a hole's diameter, depth and position in one step. 0 leaves a size unchanged."""

    id = "edit_hole"
    label = "Edit hole"
    description = (
        "Changes a round hole's diameter or depth and moves it, keeping counterbore or countersink steps. "
        "Select a face of the hole or the circle at its opening; 0 leaves a size unchanged, and a depth as long as the body is through. "
        "Step depth sets how deep the counterbore or countersink at the opening goes (the far end's has End step depth)."
    )
    params = [Param("diameter", "length", 0.0), Param("depth", "length", 0.0), Param("start", "length", 0.0), Param("dx", "length"), Param("dy", "length"), Param("dz", "length"), Param("step_depth", "length", 0.0), Param("end_step_depth", "length", 0.0)]
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
        final_through = changes.get("through", info.through)
        final_end = changes.get("depth", info.pass_length if info.through else info.depth)
        radius = changes.get("diameter", info.diameter) / 2
        for name, steps, key in (("step_depth", info.stages, "stages"), ("end_step_depth", info.end_stages, "end_stages")):
            wanted = values[name]
            if wanted < 0:
                raise OperationError("A step depth can't be negative")
            if wanted < MIN_DISTANCE:
                continue
            if not steps:
                raise OperationError("This hole has no counterbore or countersink " + ("at the opening" if key == "stages" else "at the far end"))
            if key == "end_stages" and not final_through:
                raise OperationError("Only a through hole has a step at its far end")
            if wanted > final_end - 10 * CLEARANCE:
                raise OperationError("The step must be shallower than the hole")
            changes[key] = [_with_step_depth(steps[0], radius, wanted)] + [dict(x) for x in steps[1:]]
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
        # A grip on the shoulder of the counterbore or countersink at the opening, and at the far end of a through hole.
        radius = diameter / 2
        if info.stages and values["start"] < MIN_DISTANCE:
            now = values["step_depth"] if values["step_depth"] >= MIN_DISTANCE else _step_height(info.stages[0], radius)
            out.append(Handle("step_depth", "Step depth (counterbore or countersink)", at(now), axis, min=10 * CLEARANCE, max=end - 10 * CLEARANCE, kind="resize", shown=now, axis_from=at(0.0)))
        if info.end_stages and (info.through or depth >= info.pass_length - MIN_DISTANCE):
            now = values["end_step_depth"] if values["end_step_depth"] >= MIN_DISTANCE else _step_height(info.end_stages[0], radius)
            back = tuple(-c for c in axis)
            out.append(Handle("end_step_depth", "Far end step depth", at(end - now), back, min=10 * CLEARANCE, max=end - 10 * CLEARANCE, kind="resize", shown=now, axis_from=at(end)))
        middle = at(end / 2)
        names = ("dx", "dy", "dz")
        for i in across:
            direction = tuple(1.0 if k == i else 0.0 for k in range(3))
            out.append(Handle(names[i], f"Move along {'XYZ'[i]}", middle, direction, kind="move"))
        return out


def _step_height(stage: dict, radius: float) -> float:
    """How far along the axis a counterbore or countersink step reaches: its depth, or the height of its cone."""
    if stage["type"] == "countersink":
        return (stage["diameter"] / 2 - radius) / math.tan(math.radians(stage["angle"]) / 2)
    return stage["depth"]


def _with_step_depth(stage: dict, radius: float, depth: float) -> dict:
    """The step with another depth; a countersink keeps its angle, so a deeper cone is a wider mouth."""
    if stage["type"] == "countersink":
        return {**stage, "diameter": 2 * (radius + depth * math.tan(math.radians(stage["angle"]) / 2)), "depth": depth}
    return {**stage, "depth": depth}

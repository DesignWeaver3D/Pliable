"""Solving a sketch in steps and writing the solution back: a long drag, or a size change on a sketch with an elliptical arc, is
reached through shorter moves so the solver stays on the branch it started on."""

import math

from .solver import _solved, conflicting_constraints, point_freedom


MAX_DRAG_STEP = 0.05  # a drag longer than this fraction of the sketch's size is solved in steps


MAX_DRAG_STEPS = 40  # an abrupt drag across the whole sketch still moves in steps of about a twentieth of its size


def _extent(sketch: dict) -> float:
    pts = sketch.get("points", [])
    if not pts:
        return 1.0
    us, vs = [p["u"] for p in pts], [p["v"] for p in pts]
    return max(max(us) - min(us), max(vs) - min(vs), 1.0)


def _drag_steps(sketch: dict, drag: dict) -> list[dict]:
    """The drag split into smaller moves. The solver finds the solution nearest where the geometry is now, so a
    long jump can land on the other branch of a tangency or a mirrored corner; short steps follow the right one."""
    held = drag["points"] if "points" in drag else [drag]
    old = {p["id"]: p for p in sketch.get("points", [])}
    longest = max((math.dist((old[h["point"]]["u"], old[h["point"]]["v"]), (h["u"], h["v"])) for h in held if h["point"] in old), default=0.0)
    count = min(MAX_DRAG_STEPS, math.ceil(longest / (MAX_DRAG_STEP * _extent(sketch))))
    if count <= 1:
        return [drag]
    steps = []
    for k in range(1, count + 1):
        t = k / count
        moved = [{"point": h["point"], "u": old[h["point"]]["u"] + (h["u"] - old[h["point"]]["u"]) * t, "v": old[h["point"]]["v"] + (h["v"] - old[h["point"]]["v"]) * t} if h["point"] in old else h for h in held]
        steps.append({"points": moved})
    return steps


ARC_STEPS = 8  # a size changed on a sketch with an elliptical arc is reached in this many steps


def _measured(sketch: dict, c: dict) -> float | None:
    """What a distance or minor radius dimension measures on the geometry now, or None for any other constraint."""
    at = {p["id"]: (p["u"], p["v"]) for p in sketch.get("points", [])}
    entities = {e["id"]: e for e in sketch.get("entities", [])}
    try:
        if c["type"] == "distance" and "points" in c:
            return math.dist(at[c["points"][0]], at[c["points"][1]])
        if c["type"] == "distance" and entities[c["entity"]]["type"] == "line":
            return math.dist(at[entities[c["entity"]]["a"]], at[entities[c["entity"]]["b"]])
        if c["type"] == "minor_radius":
            e = entities[c["entity"]]
            return math.dist(at[e["center"]], at[e["minor1"]]) if "minor1" in e else e["minor"]
    except KeyError:
        return None
    return None


def _in_steps(sketch: dict) -> dict | None:
    """The sketch solved with its distance and minor radius dimensions moved from what they measure now to their values in steps, or None
    when there is nothing to step. The points on an elliptical arc are tied to it through the foci, and one jump to a much smaller or larger
    size can land on a solution where the ellipse itself is stretched; short steps keep the ellipse and carry the ends along it."""
    if not any(e["type"] == "ellipse" and "start" in e for e in sketch.get("entities", [])):
        return None
    start = {c["id"]: _measured(sketch, c) for c in sketch.get("constraints", []) if not c.get("reference") and isinstance(c.get("value"), (int, float))}
    moving = {i: m for i, m in start.items() if m is not None and abs(m - next(c for c in sketch["constraints"] if c["id"] == i)["value"]) > 0.02 * max(m, 1e-9)}
    if not moving:
        return None
    current, result = sketch, None
    for k in range(1, ARC_STEPS + 1):
        step = {**current, "constraints": [{**c, "value": moving[c["id"]] + (c["value"] - moving[c["id"]]) * k / ARC_STEPS} if c["id"] in moving and k < ARC_STEPS else c for c in sketch["constraints"]]}
        result = _solved(step)[1]
        if result["status"] != "ok":
            return None  # let the single solve report the failure
        current = apply_solution(step, result)
    return result


def solve(sketch: dict, drag: dict | None = None, detail: bool = False) -> dict:
    """Solve the sketch's constraints. `drag` = {"point": id, "u", "v"} holds one point where the pointer is
    (it is pinned there while everything else follows the constraints); {"points": [...]} holds several. On failure the points are unchanged.
    A long drag is solved in steps from where the geometry is now, so it follows the branch it started on; if a
    later step fails, the last step that worked is returned.

    `detail` adds what the sketch editor shows when nothing is being dragged: on success `freedom` (point id ->
    directions still free), on failure `conflicts` (constraint ids to blame)."""
    if not drag:
        result = _in_steps(sketch) or _solved(sketch)[1]
        if detail:
            if result["status"] == "ok":
                result["freedom"] = point_freedom(sketch)
            else:
                result["conflicts"] = conflicting_constraints(sketch)
        return result
    current, result = sketch, None
    for step in _drag_steps(sketch, drag):
        attempt = _solved(current, step)[1]
        if attempt["status"] != "ok":
            if result is None:
                result = attempt
            break
        result = attempt
        current = apply_solution(current, attempt)
    if result["status"] == "ok":
        _keep_unconnected(sketch, drag, result)
    return result


def _connected_ids(sketch: dict, start: set[int]) -> set[int]:
    """Ids (points, entities) reachable from `start` through entities and constraints: the part of the sketch
    that dragging one of `start` may legitimately move."""
    links: list[set[int]] = []
    for e in sketch.get("entities", []):
        links.append({e["id"], *(e[k] for k in ("a", "b", "center", "start", "end", "major", "major2", "minor1", "minor2") if k in e), *e.get("points", [])})
    for c in sketch.get("constraints", []):
        group = {*c.get("points", []), *c.get("entities", [])}
        group.update(c[k] for k in ("point", "entity") if k in c)
        if len(group) > 1:
            links.append(group)
    reached = set(start)
    changed = True
    while changed:
        changed = False
        for group in links:
            if group & reached and not group <= reached:
                reached |= group
                changed = True
    return reached


def _keep_unconnected(sketch: dict, drag: dict, result: dict) -> None:
    """Whatever the solver did, geometry with no constraint path to the dragged points stays exactly where it was:
    unconstrained geometry moves freely and only what the constraints require follows."""
    held = {h["point"] for h in (drag["points"] if "points" in drag else [drag])}
    reached = _connected_ids(sketch, held)
    old = {p["id"]: p for p in sketch.get("points", [])}
    for q in result["points"]:
        if q["id"] not in reached and q["id"] in old:
            q["u"], q["v"] = old[q["id"]]["u"], old[q["id"]]["v"]
    for e in sketch.get("entities", []):
        if e["id"] not in reached and e["id"] in result["radii"] and ("radius" in e or "minor" in e):
            result["radii"][e["id"]] = e.get("radius", e.get("minor"))


def apply_solution(sketch: dict, result: dict) -> dict:
    """The sketch with the solver's coordinates and radii written back."""
    new = {**sketch, "points": [dict(p) for p in sketch.get("points", [])], "entities": [dict(e) for e in sketch.get("entities", [])]}
    solved = {p["id"]: p for p in result["points"]}
    for p in new["points"]:
        if p["id"] in solved:
            p["u"], p["v"] = solved[p["id"]]["u"], solved[p["id"]]["v"]
    for e in new["entities"]:
        if e["id"] in result["radii"]:
            e["minor" if e["type"] == "ellipse" else "radius"] = result["radii"][e["id"]]
    return new

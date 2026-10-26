"""Point freedom worked out one connected part of the sketch at a time.

Each test solves the whole sketch it is given, so a sketch of many separate shapes is slow to test point by point. Shapes
that share no point and no constraint cannot affect each other, so each is tested alone (a fully placed one costs a single solve)."""

import time

from .solver import _entity_point_ids, point_freedom


def _constraint_points(c: dict, entity_points: dict[int, list[int]]) -> list[int]:
    ids = list(c.get("points", []))
    if "point" in c:
        ids.append(c["point"])
    for key in ("entity",):
        if key in c:
            ids += entity_points.get(c[key], [])
    for eid in c.get("entities", []):
        ids += entity_points.get(eid, [])
    return ids


def sketch_parts(sketch: dict) -> list[dict]:
    """The sketch split into parts that share no point and no constraint."""
    entity_points = {e["id"]: _entity_point_ids(e) for e in sketch.get("entities", [])}
    parent: dict[int, int] = {p["id"]: p["id"] for p in sketch.get("points", [])}

    def find(i):
        while parent.setdefault(i, i) != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    def join(ids):
        for other in ids[1:]:
            parent[find(other)] = find(ids[0])

    for ids in entity_points.values():
        join(ids)
    for c in sketch.get("constraints", []):
        join(_constraint_points(c, entity_points))
    parts: dict[int, dict] = {}

    def part(root):
        return parts.setdefault(find(root), {**sketch, "points": [], "entities": [], "constraints": []})

    for p in sketch.get("points", []):
        part(p["id"])["points"].append(p)
    for e in sketch.get("entities", []):
        ids = entity_points[e["id"]]
        if ids:
            part(ids[0])["entities"].append(e)
    for c in sketch.get("constraints", []):
        ids = _constraint_points(c, entity_points)
        if ids:
            part(ids[0])["constraints"].append(c)
    return list(parts.values())


def point_freedom_by_part(sketch: dict, budget: float | None = None) -> dict[int, int]:
    """Same answer as `point_freedom`, but the time `budget` is shared by the parts and each part is tested alone."""
    deadline = None if budget is None else time.monotonic() + budget
    freedom: dict[int, int] = {}
    for part in sketch_parts(sketch):
        left = None if deadline is None else deadline - time.monotonic()
        freedom.update(point_freedom(part, budget=left))
    return freedom

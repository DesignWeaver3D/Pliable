"""Arcs about one center that join end to end into a closed loop (a circle trimmed into arcs) solve like the circle they make."""
from pliable.sketch.solver import solve

PLANE = {"origin": [0, 0, 0], "normal": [0, 0, 1], "xdir": [1, 0, 0]}
POINTS = [{"id": 1, "u": 0, "v": 0}, {"id": 2, "u": 3, "v": 0}, {"id": 3, "u": -3, "v": 0}, {"id": 4, "u": 0, "v": 3}]


def sketch(entities, constraints=()):
    return {"plane": PLANE, "points": POINTS, "entities": entities, "constraints": list(constraints)}


def test_two_arcs_closing_a_loop_solve():
    result = solve(sketch([{"id": 10, "type": "arc", "center": 1, "start": 2, "end": 3}, {"id": 11, "type": "arc", "center": 1, "start": 3, "end": 2}]))
    assert result["status"] == "ok"


def test_three_arcs_closing_a_loop_solve_and_take_a_radius():
    arcs = [
        {"id": 10, "type": "arc", "center": 1, "start": 2, "end": 4},
        {"id": 11, "type": "arc", "center": 1, "start": 4, "end": 3},
        {"id": 12, "type": "arc", "center": 1, "start": 3, "end": 2},
    ]
    result = solve(sketch(arcs, [{"id": 20, "type": "radius", "entity": 12, "value": 5}]))
    assert result["status"] == "ok"
    points = {p["id"]: p for p in result["points"]}
    assert abs((points[2]["u"] - points[1]["u"]) ** 2 + (points[2]["v"] - points[1]["v"]) ** 2 - 25) < 1e-6  # the radius set on the closing arc moves the shared ends


def test_an_open_chain_of_arcs_still_has_each_arc_of_its_own():
    arcs = [{"id": 10, "type": "arc", "center": 1, "start": 2, "end": 4}, {"id": 11, "type": "arc", "center": 1, "start": 4, "end": 3}]
    assert solve(sketch(arcs))["status"] == "ok"

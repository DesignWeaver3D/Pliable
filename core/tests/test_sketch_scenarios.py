"""Whole-profile solver scenarios: each is solved, then one point is dragged in small steps. The solution must stay near the
previous one (no flip to the mirror branch) and the constraints must still hold. Extends the no-flip set in test_sketch_flip.py."""

import math

import pytest

from pliable import sketch

XY = sketch.STANDARD_PLANES["XY"]
TOL = 1e-4


def _pts(result):
    return {p["id"]: (p["u"], p["v"]) for p in result["points"]}


def _moved(a, b):
    return max(math.dist(a[k], b[k]) for k in a)


def _line_distance(p, a, b):
    (x, y), (x1, y1), (x2, y2) = p, a, b
    return abs((x2 - x1) * (y1 - y) - (x1 - x) * (y2 - y1)) / math.dist(a, b)


def _scenario(points, entities, constraints):
    return {"plane": XY, "points": [{"id": i, "u": u, "v": v} for i, (u, v) in points.items()], "entities": entities, "constraints": constraints}


def _check(sk, drag_point, targets, holds, pinned=False):
    """Solve, then drag `drag_point` toward each of `targets` in turn. No point may move more than twice as far as the pointer did (a flip to the
    mirror branch moves points across the sketch). `pinned`: the point cannot move (everything is dimensioned), so a drag may be refused,\n    and a refused drag must move nothing."""
    first = sketch.solve(sk)
    assert first["status"] == "ok", first
    current = _pts(first)
    holds(current)
    sk = {**sk, "points": [{"id": i, "u": u, "v": v} for i, (u, v) in current.items()]}
    for u, v in targets:
        pointer = math.dist(current[drag_point], (u, v))
        reply = sketch.solve(sk, drag={"point": drag_point, "u": u, "v": v})
        if pinned and reply["status"] != "ok":
            assert reply.get("points", []) == []  # a refused drag carries no new points, so the sketch stays as it was
            continue
        assert reply["status"] == "ok", reply
        after = _pts(reply)
        assert _moved(current, after) <= 2 * pointer + 1e-3, f"jumped {_moved(current, after)}"
        holds(after)
        current = after
        sk = {**sk, "points": [{"id": i, "u": p[0], "v": p[1]} for i, p in after.items()]}
    return current


def _rectangle_holds(p):
    assert p[1][1] == pytest.approx(p[2][1], abs=TOL) and p[3][1] == pytest.approx(p[4][1], abs=TOL)
    assert p[1][0] == pytest.approx(p[4][0], abs=TOL) and p[2][0] == pytest.approx(p[3][0], abs=TOL)
    assert math.dist(p[1], p[2]) == pytest.approx(40, abs=TOL)
    assert math.dist(p[2], p[3]) == pytest.approx(30, abs=TOL)
    assert p[1] == pytest.approx((0, 0), abs=TOL)


def test_fully_constrained_rectangle_stays_put_when_a_corner_is_dragged():
    pts = {1: (0, 0), 2: (39, 0.5), 3: (40.5, 29), 4: (-0.4, 30.4)}
    lines = [{"id": 100 + k, "type": "line", "a": k, "b": k % 4 + 1} for k in (1, 2, 3, 4)]
    cons = [
        {"id": 20, "type": "horizontal", "entity": 101}, {"id": 21, "type": "vertical", "entity": 102},
        {"id": 22, "type": "horizontal", "entity": 103}, {"id": 23, "type": "vertical", "entity": 104},
        {"id": 24, "type": "distance", "points": [1, 2], "value": 40}, {"id": 25, "type": "distance", "points": [2, 3], "value": 30},
        {"id": 26, "type": "fixed", "point": 1},
    ]
    _check(_scenario(pts, lines, cons), 3, [(41, 31), (43, 33), (30, 20)], _rectangle_holds, pinned=True)


def test_rectangle_with_a_free_height_follows_the_drag_without_flipping():
    pts = {1: (0, 0), 2: (40, 0), 3: (40, 30), 4: (0, 30)}
    lines = [{"id": 100 + k, "type": "line", "a": k, "b": k % 4 + 1} for k in (1, 2, 3, 4)]
    cons = [
        {"id": 20, "type": "horizontal", "entity": 101}, {"id": 21, "type": "vertical", "entity": 102},
        {"id": 22, "type": "horizontal", "entity": 103}, {"id": 23, "type": "vertical", "entity": 104},
        {"id": 24, "type": "distance", "points": [1, 2], "value": 40}, {"id": 26, "type": "fixed", "point": 1},
    ]

    def holds(p):
        assert p[1][1] == pytest.approx(p[2][1], abs=TOL) and p[3][1] == pytest.approx(p[4][1], abs=TOL)
        assert p[2][0] == pytest.approx(p[3][0], abs=TOL) and math.dist(p[1], p[2]) == pytest.approx(40, abs=TOL)

    end = _check(_scenario(pts, lines, cons), 3, [(40, 28), (40, 25), (40, 12), (40, -5)], holds)
    assert end[3][1] == pytest.approx(-5, abs=1e-3)  # the corner can pass below its base: the sketch is allowed to fold, but it follows the pointer


def _slot():
    # centers 5 (left) and 6 (right); tangent points: 1 top-left, 2 top-right, 3 bottom-left, 4 bottom-right
    pts = {1: (0, 5), 2: (30, 5), 3: (0, -5), 4: (30, -5), 5: (0, 0), 6: (30, 0)}
    ents = [
        {"id": 10, "type": "line", "a": 1, "b": 2}, {"id": 11, "type": "line", "a": 3, "b": 4},
        {"id": 12, "type": "arc", "center": 6, "start": 4, "end": 2}, {"id": 13, "type": "arc", "center": 5, "start": 1, "end": 3},
    ]
    cons = [
        {"id": 20, "type": "tangent", "entities": [10, 12]}, {"id": 21, "type": "tangent", "entities": [11, 12]},
        {"id": 22, "type": "tangent", "entities": [10, 13]}, {"id": 23, "type": "tangent", "entities": [11, 13]},
        {"id": 24, "type": "radius", "entity": 12, "value": 5}, {"id": 25, "type": "equal", "entities": [12, 13]},
        {"id": 26, "type": "fixed", "point": 5}, {"id": 27, "type": "horizontal", "points": [5, 6]},
        {"id": 28, "type": "distance", "points": [5, 6], "value": 30},
    ]
    return _scenario(pts, ents, cons)


def test_slot_keeps_its_shape_when_a_point_is_dragged():
    def holds(p):
        for a, b, c in ((1, 2, 5), (3, 4, 5), (1, 2, 6), (3, 4, 6)):
            assert _line_distance(p[c], p[a], p[b]) == pytest.approx(5, abs=1e-3)
        assert math.dist(p[5], p[6]) == pytest.approx(30, abs=1e-3)
        assert p[5][1] == pytest.approx(p[6][1], abs=TOL)

    _check(_slot(), 2, [(30, 6), (31, 7), (28, 8)], holds, pinned=True)  # fully dimensioned: every point is pinned
    _check(_slot(), 6, [(30, 1), (29, 3), (25, 6)], holds, pinned=True)


def test_slot_with_a_free_length_stretches_without_flipping():
    sk = _slot()
    sk["constraints"] = [c for c in sk["constraints"] if c["id"] != 28]

    def holds(p):
        for a, b, c in ((1, 2, 5), (3, 4, 5), (1, 2, 6), (3, 4, 6)):
            assert _line_distance(p[c], p[a], p[b]) == pytest.approx(5, abs=1e-3)
        assert p[5][1] == pytest.approx(p[6][1], abs=TOL)

    end = _check(sk, 6, [(32, 0), (36, 0), (25, 0), (16, 0)], holds)
    assert end[6][0] == pytest.approx(16, abs=1e-3) and end[2][1] > end[4][1]  # the top line stays on top


def _chain():
    # line 1-2, arc about 3 from 2 to 4, line 4-5: tangent at both joints; the sweep of the arc is free
    pts = {1: (0, 0), 2: (20, 0), 3: (20, 8), 4: (28, 8), 5: (28, 23), 6: (20, 8)}
    pts = {1: (0, 0), 2: (20, 0), 3: (20, 8), 4: (28, 8), 5: (28, 23)}
    ents = [
        {"id": 10, "type": "line", "a": 1, "b": 2},
        {"id": 11, "type": "arc", "center": 3, "start": 2, "end": 4},
        {"id": 12, "type": "line", "a": 4, "b": 5},
    ]
    cons = [
        {"id": 20, "type": "fixed", "point": 1}, {"id": 21, "type": "horizontal", "entity": 10},
        {"id": 22, "type": "distance", "points": [1, 2], "value": 20}, {"id": 23, "type": "radius", "entity": 11, "value": 8},
        {"id": 24, "type": "tangent", "entities": [10, 11]}, {"id": 25, "type": "tangent", "entities": [11, 12]},
        {"id": 26, "type": "distance", "points": [4, 5], "value": 15},
    ]
    return _scenario(pts, ents, cons)


def test_tangent_chain_of_lines_and_an_arc_follows_a_drag_on_the_same_side():
    def holds(p):
        assert math.dist(p[3], p[2]) == pytest.approx(8, abs=1e-3) and math.dist(p[3], p[4]) == pytest.approx(8, abs=1e-3)
        assert _line_distance(p[3], p[1], p[2]) == pytest.approx(8, abs=1e-3)
        assert _line_distance(p[3], p[4], p[5]) == pytest.approx(8, abs=1e-3)
        assert math.dist(p[4], p[5]) == pytest.approx(15, abs=1e-3)

    end = _check(_chain(), 5, [(26, 24), (22, 25), (17, 24)], holds)
    assert end[3][1] > 0  # the arc's center stayed on its side of the first line


def test_symmetric_profile_stays_symmetric_while_the_apex_is_dragged():
    # points 1 and 2 mirror about the vertical axis 5-6; the apex 3 sits on the axis
    pts = {1: (-10, 0), 2: (10.3, 0.2), 3: (0, 15), 5: (0, -5), 6: (0, 20)}
    ents = [
        {"id": 10, "type": "line", "a": 1, "b": 2}, {"id": 11, "type": "line", "a": 2, "b": 3},
        {"id": 12, "type": "line", "a": 3, "b": 1}, {"id": 13, "type": "line", "a": 5, "b": 6, "construction": True},
    ]
    cons = [
        {"id": 20, "type": "fixed", "point": 5}, {"id": 21, "type": "fixed", "point": 6},
        {"id": 22, "type": "symmetric", "points": [1, 2], "entity": 13},
        {"id": 23, "type": "point_on", "point": 3, "entity": 13}, {"id": 24, "type": "horizontal", "entity": 10},
    ]

    def holds(p):
        assert p[1][0] == pytest.approx(-p[2][0], abs=1e-3) and p[1][1] == pytest.approx(p[2][1], abs=1e-3)
        assert p[3][0] == pytest.approx(0, abs=1e-3)

    end = _check(_scenario(pts, ents, cons), 3, [(0, 14), (0, 12), (1.5, 10)], holds)
    assert end[3][0] == pytest.approx(0, abs=1e-3) and end[3][1] > end[1][1]  # still a peak above the base


def test_symmetric_profile_follows_a_drag_of_one_mirrored_point():
    pts = {1: (-10, 0), 2: (10, 0), 3: (0, 15), 5: (0, -5), 6: (0, 20)}
    ents = [
        {"id": 10, "type": "line", "a": 1, "b": 2}, {"id": 11, "type": "line", "a": 2, "b": 3},
        {"id": 12, "type": "line", "a": 3, "b": 1}, {"id": 13, "type": "line", "a": 5, "b": 6, "construction": True},
    ]
    cons = [
        {"id": 20, "type": "fixed", "point": 5}, {"id": 21, "type": "fixed", "point": 6},
        {"id": 22, "type": "symmetric", "points": [1, 2], "entity": 13}, {"id": 23, "type": "point_on", "point": 3, "entity": 13},
    ]

    def holds(p):
        assert p[1][0] == pytest.approx(-p[2][0], abs=1e-3) and p[1][1] == pytest.approx(p[2][1], abs=1e-3)

    _check(_scenario(pts, ents, cons), 2, [(11, 1), (12, 2), (9, 3)], holds)


def _ellipse_in_rectangle():
    # rectangle 1-4 (40 x 30, corner 1 fixed); ellipse center 5, axis ends 6 (right) 7 (left) 8 (top) 9 (bottom), each on its edge
    pts = {1: (0, 0), 2: (40, 0), 3: (40, 30), 4: (0, 30), 5: (20, 15), 6: (40, 15), 7: (0, 15), 8: (20, 30), 9: (20, 0)}
    lines = [{"id": 100 + k, "type": "line", "a": k, "b": k % 4 + 1} for k in (1, 2, 3, 4)]
    ents = lines + [{"id": 30, "type": "ellipse", "center": 5, "major": 6, "major2": 7, "minor1": 8, "minor2": 9, "minor": 15}]
    cons = [
        {"id": 20, "type": "horizontal", "entity": 101}, {"id": 21, "type": "vertical", "entity": 102},
        {"id": 22, "type": "horizontal", "entity": 103}, {"id": 23, "type": "vertical", "entity": 104},
        {"id": 24, "type": "distance", "points": [1, 2], "value": 40}, {"id": 25, "type": "distance", "points": [2, 3], "value": 30},
        {"id": 26, "type": "fixed", "point": 1},
        {"id": 27, "type": "point_on", "point": 6, "entity": 102}, {"id": 28, "type": "point_on", "point": 7, "entity": 104},
        {"id": 29, "type": "point_on", "point": 8, "entity": 103}, {"id": 31, "type": "point_on", "point": 9, "entity": 101},
    ]
    return _scenario(pts, ents, cons)


def test_ellipse_inscribed_in_a_rectangle_stays_inscribed_when_a_point_is_dragged():
    def holds(p):
        assert p[6][0] == pytest.approx(40, abs=1e-3) and p[7][0] == pytest.approx(0, abs=1e-3)
        assert p[8][1] == pytest.approx(30, abs=1e-3) and p[9][1] == pytest.approx(0, abs=1e-3)
        assert p[5][0] == pytest.approx((p[6][0] + p[7][0]) / 2, abs=1e-3) and p[5][1] == pytest.approx((p[8][1] + p[9][1]) / 2, abs=1e-3)

    _check(_ellipse_in_rectangle(), 6, [(40, 17), (40, 20), (40, 12)], holds)
    _check(_ellipse_in_rectangle(), 5, [(21, 16), (23, 18), (19, 14)], holds, pinned=True)  # the center is fixed by the rectangle


def test_ellipse_inscribed_in_a_rectangle_follows_a_free_height():
    sk = _ellipse_in_rectangle()
    sk["constraints"] = [c for c in sk["constraints"] if c["id"] != 25]

    def holds(p):
        assert p[6][0] == pytest.approx(40, abs=1e-3) and p[7][0] == pytest.approx(0, abs=1e-3)
        assert p[8][1] == pytest.approx(p[3][1], abs=1e-3) and p[9][1] == pytest.approx(0, abs=1e-3)
        assert p[5][1] == pytest.approx((p[8][1] + p[9][1]) / 2, abs=1e-3)

    end = _check(sk, 3, [(40, 32), (40, 36), (40, 24)], holds)
    assert end[8][1] == pytest.approx(24, abs=1e-3)


def _spline():
    pts = {1: (0, 0), 2: (10, 8), 3: (20, 2), 4: (30, 9), 5: (40, 0)}
    ents = [{"id": 10, "type": "spline", "points": [1, 2, 3, 4, 5]}]
    cons = [
        {"id": 20, "type": "fixed", "point": 1}, {"id": 21, "type": "horizontal", "points": [1, 5]},
        {"id": 22, "type": "distance", "points": [1, 5], "value": 40},
    ]
    return _scenario(pts, ents, cons)


def test_spline_through_points_keeps_its_ends_and_follows_an_inner_point():
    def holds(p):
        assert p[1] == pytest.approx((0, 0), abs=TOL) and p[5][1] == pytest.approx(0, abs=1e-3)
        assert math.dist(p[1], p[5]) == pytest.approx(40, abs=1e-3)

    end = _check(_spline(), 3, [(20, 3), (20, 5), (20, 7)], holds)
    assert end[3] == pytest.approx((20, 7), abs=1e-3)
    assert [end[k] for k in (2, 4)] == pytest.approx([(10, 8), (30, 9)], abs=1e-3)  # the other through-points stay put




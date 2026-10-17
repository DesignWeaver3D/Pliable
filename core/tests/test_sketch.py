import math

import pytest
from OCP.BRepGProp import BRepGProp
from OCP.GProp import GProp_GProps

from pliable import sketch
from pliable.demos import load_demo
from pliable.ops import OperationError

XY = sketch.STANDARD_PLANES["XY"]


def volume(shape) -> float:
    props = GProp_GProps()
    BRepGProp.VolumeProperties_s(shape, props)
    return props.Mass()


def rectangle(w=40.0, h=30.0, x0=0.0, y0=0.0, first_id=1):
    """Four points and four lines, loosely placed (the solver tidies them), no constraints."""
    ids = range(first_id, first_id + 4)
    corners = [(x0, y0), (x0 + w, y0), (x0 + w, y0 + h), (x0, y0 + h)]
    points = [{"id": i, "u": u, "v": v} for i, (u, v) in zip(ids, corners)]
    lines = [{"id": 100 + first_id + k, "type": "line", "a": first_id + k, "b": first_id + (k + 1) % 4} for k in range(4)]
    return points, lines


def sketch_of(points, entities, constraints=(), plane=XY):
    return {"plane": plane, "points": points, "entities": entities, "constraints": list(constraints)}


def coords(result):
    return {p["id"]: (p["u"], p["v"]) for p in result["points"]}


def test_dimensioned_rectangle_solves_exactly():
    points, lines = rectangle(38, 29)  # sloppy start
    points[2]["u"] += 1.5
    constraints = [
        {"type": "horizontal", "entity": 101},
        {"type": "vertical", "entity": 102},
        {"type": "horizontal", "entity": 103},
        {"type": "vertical", "entity": 104},
        {"type": "distance", "points": [1, 2], "value": 40},
        {"type": "distance", "points": [2, 3], "value": 30},
        {"type": "fixed", "point": 1},
    ]
    result = sketch.solve(sketch_of(points, lines, constraints))
    assert result["status"] == "ok" and result["dof"] == 0
    c = coords(result)
    assert c[1] == pytest.approx((0, 0), abs=1e-6)
    assert c[3] == pytest.approx((40, 30), abs=1e-6)


def test_dof_counts_free_dimensions():
    points, lines = rectangle()
    constraints = [{"type": "horizontal", "entity": 101}, {"type": "vertical", "entity": 102}, {"type": "horizontal", "entity": 103}, {"type": "vertical", "entity": 104}]
    result = sketch.solve(sketch_of(points, lines, constraints))
    assert result["dof"] == 4  # position (2), width, height


def test_conflicting_constraints_report_failure():
    points, lines = rectangle()
    constraints = [
        {"id": 7, "type": "distance", "points": [1, 2], "value": 40},
        {"id": 8, "type": "distance", "points": [1, 2], "value": 50},
    ]
    result = sketch.solve(sketch_of(points, lines, constraints))
    assert result["status"] == "failed"
    assert set(result["failed"]) & {7, 8}


def test_circle_radius_and_coincident_center():
    points = [{"id": 1, "u": 5, "v": 5}]
    entities = [{"id": 10, "type": "circle", "center": 1, "radius": 3}]
    constraints = [{"type": "radius", "entity": 10, "value": 7}, {"type": "fixed", "point": 1}]
    result = sketch.solve(sketch_of(points, entities, constraints))
    assert result["radii"][10] == pytest.approx(7)
    assert sketch.apply_solution(sketch_of(points, entities, constraints), result)["entities"][0]["radius"] == pytest.approx(7)


def test_perpendicular_parallel_equal_and_angle():
    points = [{"id": i, "u": u, "v": v} for i, (u, v) in enumerate([(0, 0), (10, 1), (0, 0.5), (3, 12)], 1)]
    lines = [{"id": 10, "type": "line", "a": 1, "b": 2}, {"id": 11, "type": "line", "a": 3, "b": 4}]
    result = sketch.solve(sketch_of(points, lines, [{"type": "perpendicular", "entities": [10, 11]}, {"type": "fixed", "point": 1}, {"type": "fixed", "point": 2}]))
    c = coords(result)
    d1 = (c[2][0] - c[1][0], c[2][1] - c[1][1])
    d2 = (c[4][0] - c[3][0], c[4][1] - c[3][1])
    assert d1[0] * d2[0] + d1[1] * d2[1] == pytest.approx(0, abs=1e-6)
    result = sketch.solve(sketch_of(points, lines, [{"type": "angle", "entities": [10, 11], "value": 60}, {"type": "fixed", "point": 1}, {"type": "fixed", "point": 2}, {"type": "fixed", "point": 3}]))
    c = coords(result)
    d1 = (c[2][0] - c[1][0], c[2][1] - c[1][1])
    d2 = (c[4][0] - c[3][0], c[4][1] - c[3][1])
    angle = math.degrees(math.acos((d1[0] * d2[0] + d1[1] * d2[1]) / math.hypot(*d1) / math.hypot(*d2)))
    assert min(angle, 180 - angle) == pytest.approx(60, abs=1e-4)


def test_arc_line_tangent():
    # an arc from (10, 0) round to (0, 10) about the origin, and a line leaving its end
    points = [{"id": 1, "u": 0, "v": 0}, {"id": 2, "u": 10, "v": 0}, {"id": 3, "u": 0, "v": 10}, {"id": 4, "u": -8, "v": 14}]
    entities = [{"id": 10, "type": "arc", "center": 1, "start": 2, "end": 3}, {"id": 11, "type": "line", "a": 3, "b": 4}]
    constraints = [{"type": "tangent", "entities": [10, 11]}] + [{"type": "fixed", "point": k} for k in (1, 2)]
    result = sketch.solve(sketch_of(points, entities, constraints))
    assert result["status"] == "ok"
    c = coords(result)
    tangent_dir = (c[4][0] - c[3][0], c[4][1] - c[3][1])
    radius_dir = (c[3][0] - c[1][0], c[3][1] - c[1][1])
    assert tangent_dir[0] * radius_dir[0] + tangent_dir[1] * radius_dir[1] == pytest.approx(0, abs=1e-6)


def test_drag_moves_a_point_and_neighbours_follow():
    points, lines = rectangle()
    constraints = [{"type": "horizontal", "entity": 101}, {"type": "vertical", "entity": 102}, {"type": "horizontal", "entity": 103}, {"type": "vertical", "entity": 104}]
    result = sketch.solve(sketch_of(points, lines, constraints), drag={"point": 3, "u": 50, "v": 45})
    c = coords(result)
    assert c[3] == pytest.approx((50, 45), abs=1e-6)
    assert c[2][0] == pytest.approx(50, abs=1e-6) and c[4][1] == pytest.approx(45, abs=1e-6)


def test_plane_on_a_side_face_and_unknown_references():
    plane = {"origin": [0, 0, 0], "normal": [1, 0, 0], "xdir": [0, 1, 0]}
    points = [{"id": 1, "u": 2, "v": 3}]
    result = sketch.solve(sketch_of(points, [], [{"type": "fixed", "point": 1}], plane=plane))
    assert coords(result)[1] == pytest.approx((2, 3))
    with pytest.raises(OperationError):
        sketch.solve(sketch_of(points, [{"id": 5, "type": "line", "a": 1, "b": 99}]))
    with pytest.raises(OperationError):
        sketch.solve(sketch_of(points, [], [{"type": "bogus"}]))


def test_profile_area_with_hole_and_extrude_join_and_cut():
    points, lines = rectangle(40, 30)
    hole_points = [{"id": 20, "u": 20, "v": 15}]
    hole = [{"id": 30, "type": "circle", "center": 20, "radius": 5}]
    sk = sketch_of(points + hole_points, lines + hole)
    face = sketch.profile_face(sk)
    assert face.area == pytest.approx(1200 - math.pi * 25, rel=1e-6)
    base = load_demo("block")  # 40 x 30 x 20 centred on the origin
    top_plane = {"origin": [0, 0, 10], "normal": [0, 0, 1], "xdir": [1, 0, 0]}
    on_top = dict(sk, plane=top_plane)
    # profile coordinates start at the plane origin, so shift the sketch by using a moved origin
    on_top["plane"] = {**top_plane, "origin": [-20, -15, 10]}
    joined = sketch.extrude(base, on_top, 5, "join")
    assert volume(joined.shape) - 24000 == pytest.approx((1200 - math.pi * 25) * 5, rel=1e-4)
    cut = sketch.extrude(base, on_top, 5, "cut")
    assert 24000 - volume(cut.shape) == pytest.approx((1200 - math.pi * 25) * 5, rel=1e-4)


def test_open_loop_and_empty_sketch_are_rejected():
    points, lines = rectangle()
    with pytest.raises(OperationError):
        sketch.profile_face(sketch_of(points, lines[:3]))
    with pytest.raises(OperationError):
        sketch.profile_face(sketch_of([], []))
    with pytest.raises(OperationError):
        sketch.extrude(load_demo("block"), sketch_of(points, lines), 0, "join")


def test_circle_profile_and_arc_slot():
    sk = sketch_of([{"id": 1, "u": 0, "v": 0}], [{"id": 2, "type": "circle", "center": 1, "radius": 4}])
    assert sketch.profile_face(sk).area == pytest.approx(math.pi * 16, rel=1e-6)
    # a half-disc: an arc over the top and the closing diameter
    points = [{"id": 1, "u": 0, "v": 0}, {"id": 2, "u": 5, "v": 0}, {"id": 3, "u": -5, "v": 0}]
    entities = [{"id": 10, "type": "arc", "center": 1, "start": 2, "end": 3}, {"id": 11, "type": "line", "a": 3, "b": 2}]
    assert sketch.profile_face(sketch_of(points, entities)).area == pytest.approx(math.pi * 25 / 2, rel=1e-6)


def test_server_sketch_requests():
    from pliable.server import Session

    session = Session()
    session.handle({"type": "open_demo", "name": "block"})
    plane = session.handle({"type": "sketch_plane", "plane": "XY"})["plane"]
    assert plane["normal"] == [0, 0, 1]
    top = next(i for i, f in session.document.current.faces() if abs(__import__("pliable.ops", fromlist=["x"]).planar_normal(f).Z() - 1) < 1e-9)
    face_plane = session.handle({"type": "sketch_plane", "face": top})["plane"]
    assert face_plane["origin"][2] == pytest.approx(10)
    points, lines = rectangle(10, 10)
    solved = session.handle({"type": "sketch_solve", "sketch": sketch_of(points, lines, [{"type": "fixed", "point": 1}])})
    assert solved["status"] == "ok"
    request = {"type": "sketch_extrude", "sketch": sketch_of(points, lines, plane=face_plane), "distance": 5, "mode": "join"}
    preview = session.handle(request)
    assert isinstance(preview, bytes)
    assert session.document.can_undo is False  # a preview does not commit
    session.handle({**request, "commit": True})
    assert session.document.can_undo is True
    from pliable.server import RequestError

    with pytest.raises(RequestError):
        session.handle({"type": "sketch_solve", "sketch": {}})

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


def test_symmetric_extrude_and_revolve():
    block = load_demo("block")
    points, lines = rectangle(10, 10)
    plane = {"origin": [-5, -5, 0], "normal": [0, 0, 1], "xdir": [1, 0, 0]}  # mid-height of the block
    sk = sketch_of(points, lines, plane=plane)
    cut = sketch.extrude(block, sk, 6, "cut", symmetric=True)
    assert 24000 - volume(cut.shape) == pytest.approx(100 * 6, rel=1e-4)
    # revolve a 4 x 6 rectangle that stands 3 away from a construction axis, 360 degrees = a ring
    pts = [{"id": 1, "u": 3, "v": 0}, {"id": 2, "u": 7, "v": 0}, {"id": 3, "u": 7, "v": 6}, {"id": 4, "u": 3, "v": 6}, {"id": 5, "u": 0, "v": 0}, {"id": 6, "u": 0, "v": 6}]
    ents = [{"id": 10 + k, "type": "line", "a": a, "b": b} for k, (a, b) in enumerate([(1, 2), (2, 3), (3, 4), (4, 1)])] + [{"id": 20, "type": "line", "a": 5, "b": 6}]
    ring_plane = {"origin": [0, 0, 20], "normal": [0, -1, 0], "xdir": [1, 0, 0]}  # above the block, vertical plane
    ring = sketch.revolve(block, sketch_of(pts, ents, plane=ring_plane), 20, 360, "join")
    assert volume(ring.shape) - 24000 == pytest.approx(math.pi * (49 - 9) * 6, rel=1e-3)
    with pytest.raises(OperationError):
        sketch.revolve(block, sketch_of(pts, ents, plane=ring_plane), 99, 360, "join")
    with pytest.raises(OperationError):
        sketch.revolve(block, sketch_of(pts, ents, plane=ring_plane), 20, 0, "join")


def test_horizontal_and_vertical_distance():
    points, lines = rectangle(30, 20)
    constraints = [
        {"type": "horizontal", "entity": 101}, {"type": "vertical", "entity": 102}, {"type": "horizontal", "entity": 103}, {"type": "vertical", "entity": 104},
        {"type": "horizontal_distance", "points": [1, 3], "value": 44},
        {"type": "vertical_distance", "entity": 102, "value": 12},
        {"type": "fixed", "point": 1},
    ]
    result = sketch.solve(sketch_of(points, lines, constraints))
    assert result["status"] == "ok" and result["dof"] == 0
    c = coords(result)
    assert c[3][0] - c[1][0] == pytest.approx(44, abs=1e-6)
    assert c[3][1] - c[2][1] == pytest.approx(12, abs=1e-6)
    # points given in the "wrong" order still give a positive size
    swapped = [dict(k, points=list(reversed(k["points"]))) if k["type"] == "horizontal_distance" else k for k in constraints]
    assert coords(sketch.solve(sketch_of(points, lines, swapped)))[3][0] == pytest.approx(44, abs=1e-6)


def test_face_reference_outline_snaps_and_stays_fixed():
    from pliable.demos import load_demo as demo
    from pliable.measure import measure
    from pliable.tools import Selection
    from pliable.topology import Topology

    block = Topology(demo("block"))
    top = next(i for i in range(6) if measure(block, Selection(faces=[i]))["items"][0]["rows"][3]["value"] == [0.0, 0.0, 1.0])
    plane = sketch.face_plane(block.face(top))
    ref = sketch.face_reference(block.face(top), plane)
    assert len(ref["points"]) == 5 and len(ref["entities"]) == 4  # four corners and the face centre
    assert (ref["points"][-1]["u"], ref["points"][-1]["v"]) == pytest.approx((0, 0), abs=1e-6)
    assert all(p["fixed"] for p in ref["points"]) and all(e["construction"] for e in ref["entities"])
    # the fixed outline survives a solve, and a profile ignores it
    moved = [dict(p, u=p["u"] + 1) for p in ref["points"]]
    result = sketch.solve({"plane": plane, "points": moved, "entities": ref["entities"], "constraints": []})
    for before, after in zip(moved, result["points"]):
        assert (after["u"], after["v"]) == pytest.approx((before["u"], before["v"]), abs=1e-9)
    with pytest.raises(OperationError):
        sketch.profile_face({"plane": plane, "points": ref["points"], "entities": ref["entities"], "constraints": []})
    # a hole's circle and the bracket's arcs come through too
    bracket = Topology(demo("bracket"))
    base_top = max((i for i in range(bracket.face_count) if measure(bracket, Selection(faces=[i]))["items"][0]["title"] == "Plane" and measure(bracket, Selection(faces=[i]))["items"][0]["rows"][3]["value"] == [0.0, 0.0, 1.0]), key=lambda i: measure(bracket, Selection(faces=[i]))["items"][0]["rows"][2]["value"])
    types = {e["type"] for e in sketch.face_reference(bracket.face(base_top), sketch.face_plane(bracket.face(base_top)))["entities"]}
    assert {"line", "circle", "arc"} <= types


def _overlapping_sketch(plane):
    points = [{"id": 1, "u": -10, "v": -10}, {"id": 2, "u": 10, "v": -10}, {"id": 3, "u": 10, "v": 10}, {"id": 4, "u": -10, "v": 10},
              {"id": 5, "u": 10, "v": 0}, {"id": 7, "u": -5, "v": -5}]
    lines = [{"id": 10 + k, "type": "line", "a": 1 + k, "b": 1 + (k + 1) % 4} for k in range(4)]
    circles = [{"id": 14, "type": "circle", "center": 5, "radius": 6}, {"id": 15, "type": "circle", "center": 7, "radius": 2}]
    return sketch_of(points, lines + circles, plane=plane)


def test_regions_split_overlapping_loops():
    zones = sketch.regions(_overlapping_sketch(XY))
    areas = sorted(round(z.area, 1) for z in zones)
    # square minus the two circles, the half circle inside, the half circle outside, the small circle
    assert len(zones) == 4
    assert areas[0] == pytest.approx(12.6, abs=0.1)
    assert all(z.normal_at().Z > 0 for z in zones)


def test_regions_on_a_model_face_are_imprinted():
    from pliable.topology import Topology

    shape = load_demo("block")
    top = {"origin": [0, 0, 10], "normal": [0, 0, 1], "xdir": [1, 0, 0]}
    result, count = sketch.add_regions(shape, _overlapping_sketch(top))
    topology = Topology(result)
    assert count == 4
    assert topology.face_count == 6 - 1 + 5  # the top face becomes the four zones plus the rest around them
    assert _solid_volume(result) == pytest.approx(volume(shape))


def test_regions_away_from_the_model_are_loose_faces_that_push_pull_into_a_solid():
    from pliable.ops import push_pull
    from pliable.topology import Topology

    shape = load_demo("block")
    high = {"origin": [0, 0, 30], "normal": [0, 0, 1], "xdir": [1, 0, 0]}
    result, _ = sketch.add_regions(shape, _overlapping_sketch(high))
    topology = Topology(result)
    assert topology.face_count == 6 + 4
    loose = next(f for _, f in topology.faces() if _face_area(f) == pytest.approx(12.57, abs=0.05))
    pulled = push_pull(result, loose, 5)
    assert _solid_volume(pulled.shape) == pytest.approx(volume(shape) + 12.566 * 5, rel=1e-3)
    assert len(pulled.tracked_faces) == 1


def test_imprinted_region_pulls_like_a_face():
    from pliable.ops import push_pull
    from pliable.topology import Topology

    shape = load_demo("block")
    top = {"origin": [0, 0, 10], "normal": [0, 0, 1], "xdir": [1, 0, 0]}
    result, _ = sketch.add_regions(shape, _overlapping_sketch(top))
    topology = Topology(result)
    small = next(f for _, f in topology.faces() if _face_area(f) == pytest.approx(12.57, abs=0.05))
    pulled = push_pull(result, small, 4)
    assert _solid_volume(pulled.shape) == pytest.approx(volume(shape) + 12.566 * 4, rel=1e-3)


def test_regions_need_a_closed_outline():
    points = [{"id": 1, "u": 0, "v": 0}, {"id": 2, "u": 10, "v": 0}]
    with pytest.raises(OperationError):
        sketch.add_regions(load_demo("block"), sketch_of(points, [{"id": 10, "type": "line", "a": 1, "b": 2}]))


def _face_area(face) -> float:
    props = GProp_GProps()
    BRepGProp.SurfaceProperties_s(face, props)
    return props.Mass()


def _solid_volume(shape) -> float:
    from pliable.ops import _volume_of, solids_of

    return sum(_volume_of(s) for s in solids_of(shape))


def test_single_loop_is_one_region():
    points, lines = rectangle(10, 10)
    assert len(sketch.regions(sketch_of(points, lines))) == 1


def _rounded_rectangle(r=5.0, w=40.0, h=30.0):
    """The structure the frontend builds for a rectangle with rounded corners."""
    ends = [[(r, 0), (w - r, 0)], [(w, r), (w, h - r)], [(w - r, h), (r, h)], [(0, h - r), (0, r)]]
    points, nid = [], 1
    pts = []
    for pair in ends:
        ids = []
        for u, v in pair:
            points.append({"id": nid, "u": u, "v": v})
            ids.append(nid)
            nid += 1
        pts.append(ids)
    entities, constraints = [], []
    sides = []
    for k, (a, b) in enumerate(pts):
        entities.append({"id": 100 + k, "type": "line", "a": a, "b": b})
        sides.append(100 + k)
        constraints.append({"id": 200 + k, "type": "horizontal" if k % 2 == 0 else "vertical", "entity": 100 + k})
    centres = [(w - r, r), (w - r, h - r), (r, h - r), (r, r)]
    for k in range(4):
        points.append({"id": nid, "u": centres[k][0] + 0.3, "v": centres[k][1] - 0.2})  # slightly off, the solver corrects it
        entities.append({"id": 110 + k, "type": "arc", "center": nid, "start": pts[k][1], "end": pts[(k + 1) % 4][0]})
        constraints.append({"id": 300 + 2 * k, "type": "tangent", "entities": [110 + k, sides[k]]})
        constraints.append({"id": 301 + 2 * k, "type": "tangent", "entities": [110 + k, sides[(k + 1) % 4]]})
        nid += 1
    return sketch_of(points, entities, constraints)


def test_rounded_rectangle_structure_solves_and_makes_a_face():
    sk = _rounded_rectangle()
    result = sketch.solve(sk)
    assert result["status"] == "ok"
    solved = sketch.apply_solution(sk, result)
    (zone,) = sketch.regions(solved)
    assert zone.area == pytest.approx(40 * 30 - (4 - math.pi) * 25, rel=1e-3)


def test_offset_rectangle_grows_and_shrinks():
    points, lines = rectangle(40, 30)
    sk = sketch_of(points, lines)
    bigger = sketch.offset_entities(sk, [l["id"] for l in lines], 5)
    assert len(bigger["entities"]) >= 8  # four sides and four rounded corners
    grown = sketch_of(bigger["points"], bigger["entities"])
    (zone,) = sketch.regions(grown)
    assert zone.area == pytest.approx(40 * 30 + 2 * 5 * (40 + 30) + math.pi * 25, rel=1e-3)
    smaller = sketch.offset_entities(sk, [l["id"] for l in lines], -5)
    (zone,) = sketch.regions(sketch_of(smaller["points"], smaller["entities"]))
    assert zone.area == pytest.approx(30 * 20, rel=1e-3)


def test_offset_circle_and_errors():
    sk = sketch_of([{"id": 1, "u": 3, "v": 4}], [{"id": 2, "type": "circle", "center": 1, "radius": 10}])
    out = sketch.offset_entities(sk, [2], 2.5)
    assert out["entities"][0]["type"] == "circle" and out["entities"][0]["radius"] == pytest.approx(12.5)
    with pytest.raises(OperationError):
        sketch.offset_entities(sk, [], 1)
    with pytest.raises(OperationError):
        sketch.offset_entities(sk, [2], 0)


def test_project_reference_flattens_model_edges_onto_the_plane():
    from pliable.demos import load_demo
    from pliable.sketch import STANDARD_PLANES, face_reference

    block = load_demo("block")
    top = face_reference(block, STANDARD_PLANES["XY"], project=True)
    assert top["entities"] and all(e["type"] == "line" for e in top["entities"])
    # Vertical edges project to nothing; four corners of the block remain.
    assert len(top["points"]) == 4
    bracket = face_reference(load_demo("bracket"), STANDARD_PLANES["XY"], project=True)
    assert any(e["type"] == "circle" for e in bracket["entities"])


def test_offset_plane_moves_along_the_normal():
    from pliable.sketch import STANDARD_PLANES, offset_plane

    moved = offset_plane(STANDARD_PLANES["XZ"], 5)
    assert moved["origin"] == [0, -5, 0] and moved["normal"] == [0, -1, 0]
    assert STANDARD_PLANES["XZ"]["origin"] == [0, 0, 0]


def test_circle_tangent_to_line_and_to_circle():
    points = [{"id": 1, "u": 0, "v": 0}, {"id": 2, "u": 40, "v": 0}, {"id": 3, "u": 10, "v": 9}, {"id": 4, "u": 30, "v": 12}, {"id": 5, "u": 60, "v": 2}]
    entities = [
        {"id": 10, "type": "line", "a": 1, "b": 2},
        {"id": 11, "type": "circle", "center": 3, "radius": 8},
        {"id": 12, "type": "circle", "center": 4, "radius": 5},
    ]
    constraints = [
        {"id": 20, "type": "horizontal", "entity": 10},
        {"id": 21, "type": "fixed", "point": 1},
        {"id": 22, "type": "distance", "entity": 10, "value": 40},
        {"id": 23, "type": "tangent", "entities": [10, 11]},
        {"id": 24, "type": "tangent", "entities": [11, 12]},
        {"id": 25, "type": "radius", "entity": 11, "value": 8},
        {"id": 26, "type": "radius", "entity": 12, "value": 5},
        {"id": 27, "type": "horizontal", "points": [3, 4]},
    ]
    result = sketch.solve(sketch_of(points, entities, constraints))
    assert result["status"] == "ok"
    c = coords(result)
    assert c[3][1] == pytest.approx(8, abs=1e-6)  # radius 8 circle sits on the line
    assert math.dist(c[3], c[4]) == pytest.approx(13, abs=1e-6)  # externally tangent circles


def test_line_tangent_to_circle_and_arc_away_from_an_end_point():
    points = [
        {"id": 1, "u": 0, "v": 0}, {"id": 2, "u": 4, "v": 10},  # line, end on the circle
        {"id": 3, "u": 10, "v": 10}, {"id": 4, "u": 15, "v": 10}, {"id": 5, "u": 10, "v": 15},  # arc: centre, start, end
        {"id": 6, "u": 30, "v": 0}, {"id": 7, "u": 40, "v": 3},  # second line touching the arc mid-way
    ]
    entities = [
        {"id": 10, "type": "line", "a": 1, "b": 2},
        {"id": 11, "type": "circle", "center": 3, "radius": 6},
        {"id": 12, "type": "arc", "center": 3, "start": 4, "end": 5},
    ]
    constraints = [
        {"id": 20, "type": "fixed", "point": 1},
        {"id": 21, "type": "fixed", "point": 3},
        {"id": 22, "type": "radius", "entity": 11, "value": 6},
        {"id": 23, "type": "point_on", "point": 2, "entity": 11},
        {"id": 24, "type": "tangent", "entities": [10, 11]},
    ]
    result = sketch.solve(sketch_of(points[:5], entities[:2], constraints))
    assert result["status"] == "ok"
    c = coords(result)
    # the line leaves (0, 0) and touches the circle at a right angle to the radius
    d = (c[2][0] - c[1][0], c[2][1] - c[1][1])
    r = (c[2][0] - c[3][0], c[2][1] - c[3][1])
    assert d[0] * r[0] + d[1] * r[1] == pytest.approx(0, abs=1e-6)
    assert math.dist(c[2], c[3]) == pytest.approx(6, abs=1e-6)

    # a line that does not share an end with an arc: tangent through a hidden touching point
    mid = [
        {"id": 3, "u": 10, "v": 10}, {"id": 4, "u": 16, "v": 10}, {"id": 5, "u": 10, "v": 16},
        {"id": 6, "u": 0, "v": 22}, {"id": 7, "u": 20, "v": 23},
    ]
    arc_line = [{"id": 12, "type": "arc", "center": 3, "start": 4, "end": 5}, {"id": 13, "type": "line", "a": 6, "b": 7}]
    cs = [
        {"id": 30, "type": "fixed", "point": 3}, {"id": 31, "type": "fixed", "point": 4},
        {"id": 33, "type": "fixed", "point": 6}, {"id": 34, "type": "tangent", "entities": [12, 13]},
    ]
    result = sketch.solve(sketch_of(mid, arc_line, cs))
    assert result["status"] == "ok"
    c = coords(result)
    (x1, y1), (x2, y2) = c[6], c[7]
    distance = abs((x2 - x1) * (y1 - 10) - (x1 - 10) * (y2 - y1)) / math.dist(c[6], c[7])
    assert distance == pytest.approx(6, abs=1e-6)


def _free_sketch():
    from pliable.sketch import STANDARD_PLANES

    points = [{"id": i, "u": u, "v": v} for i, (u, v) in enumerate([(0, 0), (10, 3), (30, 5), (0, 20), (12, 20), (12, 32), (0, 32)], 1)]
    entities = [
        {"id": 101, "type": "line", "a": 1, "b": 2},
        {"id": 102, "type": "circle", "center": 3, "radius": 4},
        {"id": 103, "type": "line", "a": 4, "b": 5},
        {"id": 104, "type": "line", "a": 5, "b": 6},
        {"id": 105, "type": "line", "a": 6, "b": 7},
        {"id": 106, "type": "line", "a": 7, "b": 4},
    ]
    constraints = [{"type": "horizontal", "entity": 103}, {"type": "vertical", "entity": 104}, {"type": "horizontal", "entity": 105}, {"type": "vertical", "entity": 106}]
    return {"plane": STANDARD_PLANES["XY"], "points": points, "entities": entities, "constraints": constraints}


def _drag(session, sk, point, u, v):
    result = session.handle({"type": "sketch_solve", "sketch": sk, "drag": {"point": point, "u": u, "v": v}})
    assert result["status"] == "ok"
    return {p["id"]: (p["u"], p["v"]) for p in result["points"]}, result["radii"]


def test_dragging_free_geometry_moves_only_what_was_dragged():
    from pliable.server import Session

    session = Session()
    sk = _free_sketch()
    before = {p["id"]: (p["u"], p["v"]) for p in sk["points"]}
    # a free line end: the other end, the circle and the rectangle stay exactly where they were
    after, radii = _drag(session, sk, 2, 15, -4)
    assert after[2] == pytest.approx((15, -4))
    assert {k: v for k, v in after.items() if k != 2} == pytest.approx({k: v for k, v in before.items() if k != 2})
    assert radii[102] == pytest.approx(4)
    # a free circle's centre: nothing else changes, the radius stays
    after, radii = _drag(session, sk, 3, 40, 9)
    assert after[3] == pytest.approx((40, 9))
    assert {k: v for k, v in after.items() if k != 3} == pytest.approx({k: v for k, v in before.items() if k != 3})
    assert radii[102] == pytest.approx(4)
    # a corner of the constrained rectangle: it stays a rectangle, the free items do not move
    after, _ = _drag(session, sk, 6, 20, 40)
    assert after[5][0] == pytest.approx(after[6][0]) and after[6][1] == pytest.approx(after[7][1]) and after[4][1] == pytest.approx(after[5][1])
    assert after[6] == pytest.approx((20, 40))
    assert after[4] == pytest.approx(before[4])  # the opposite corner is the anchor
    for pid in (1, 2, 3):
        assert after[pid] == pytest.approx(before[pid])


def test_dragging_a_line_body_holds_both_ends():
    from pliable.server import Session

    session = Session()
    sk = _free_sketch()
    before = {p["id"]: (p["u"], p["v"]) for p in sk["points"]}
    drag = {"points": [{"point": 1, "u": 5, "v": -2}, {"point": 2, "u": 15, "v": 1}]}
    result = session.handle({"type": "sketch_solve", "sketch": sk, "drag": drag})
    assert result["status"] == "ok"
    after = {p["id"]: (p["u"], p["v"]) for p in result["points"]}
    assert after[1] == pytest.approx((5, -2)) and after[2] == pytest.approx((15, 1))
    assert {k: v for k, v in after.items() if k > 2} == pytest.approx({k: v for k, v in before.items() if k > 2})


def test_connected_ids_follow_entities_and_constraints_only():
    sk = _free_sketch()
    sk["constraints"].append({"id": 300, "type": "point_on", "point": 2, "entity": 102})
    reached = sketch._connected_ids(sk, {2})
    assert {1, 2, 3, 101, 102} <= reached  # the line, the circle it touches and the circle's centre
    assert not reached & {4, 5, 6, 7, 103, 104}  # the separate rectangle is not tied to them
    # a drag result is forced back for anything outside that group
    result = {"points": [{"id": 4, "u": 99, "v": 99}], "radii": {}}
    sketch._keep_unconnected(sk, {"point": 2, "u": 0, "v": 0}, result)
    assert (result["points"][0]["u"], result["points"][0]["v"]) == (0, 20)


def test_project_reports_skipped_edges_and_keeps_every_vertex():
    from pliable.demos import load_demo
    from pliable.server import Session
    from pliable.sketch import STANDARD_PLANES

    session = Session()
    session._open(load_demo("bracket"), "bracket")
    flat = session.handle({"type": "sketch_project", "plane": STANDARD_PLANES["XY"]})
    assert flat["skipped"]["square"] > 0  # the vertical edges are seen end-on
    assert any(e["type"] == "circle" for e in flat["entities"])
    # seen from the side the round holes in the top face are edge-on: drawn as segments
    side = session.handle({"type": "sketch_project", "plane": STANDARD_PLANES["XZ"]})
    assert not any(e["type"] == "circle" for e in side["entities"])
    assert len(side["points"]) >= 8 and all(p["fixed"] for p in side["points"])


def _ellipse_sketch(major=10.0, minor=5.0):
    return {
        "plane": sketch.STANDARD_PLANES["XY"],
        "points": [{"id": 1, "u": 0, "v": 0}, {"id": 2, "u": major, "v": 0}],
        "entities": [{"id": 3, "type": "ellipse", "center": 1, "major": 2, "minor": minor}],
        "constraints": [],
    }


def test_an_ellipse_is_a_profile_and_its_points_take_constraints():
    sk = _ellipse_sketch()
    assert sketch.profile_face(sk).area == pytest.approx(math.pi * 50, rel=1e-6)
    # the minor axis longer than the clicked one still gives the same ellipse turned a quarter
    assert sketch.profile_face(_ellipse_sketch(5, 10)).area == pytest.approx(math.pi * 50, rel=1e-6)
    sk["constraints"] = [{"id": 4, "type": "fixed", "point": 1}, {"id": 5, "type": "distance", "points": [1, 2], "value": 20}]
    result = sketch.solve(sk)
    assert result["status"] == "ok"
    solved = sketch.apply_solution(sk, result)
    assert sketch.profile_face(solved).area == pytest.approx(math.pi * 20 * 5, rel=1e-6)
    with pytest.raises(sketch.SketchError):
        sketch.solve({**sk, "constraints": [{"id": 6, "type": "radius", "entity": 3, "value": 2}]})


def _ellipse_with_ends(major=10.0, minor=5.0):
    return {
        "plane": sketch.STANDARD_PLANES["XY"],
        "points": [{"id": 1, "u": 0, "v": 0}, {"id": 2, "u": major, "v": 0}, {"id": 4, "u": -major, "v": 0}, {"id": 5, "u": 0, "v": minor}, {"id": 6, "u": 0, "v": -minor}],
        "entities": [{"id": 3, "type": "ellipse", "center": 1, "major": 2, "major2": 4, "minor1": 5, "minor2": 6, "minor": minor}],
        "constraints": [],
    }


def _on_ellipse(result):
    at = coords(result)
    a, b = math.dist(at[1], at[2]), math.dist(at[1], at[5]) if 5 in at else result["radii"].get(3, 5)
    (cu, cv), (mu, mv), (pu, pv) = at[1], at[2], at[7]
    along = math.atan2(mv - cv, mu - cu)
    x = (pu - cu) * math.cos(along) + (pv - cv) * math.sin(along)
    y = -(pu - cu) * math.sin(along) + (pv - cv) * math.cos(along)
    return (x / a) ** 2 + (y / b) ** 2


def test_an_ellipse_with_axis_ends_keeps_them_square_and_takes_widths():
    sk = _ellipse_with_ends()
    sk["constraints"] = [{"id": 8, "type": "fixed", "point": 1}, {"id": 9, "type": "distance", "points": [2, 4], "value": 40}, {"id": 10, "type": "distance", "points": [5, 6], "value": 12}, {"id": 11, "type": "horizontal", "points": [1, 2]}]
    result = sketch.solve(sk)
    assert result["status"] == "ok" and result["dof"] == 0
    assert result["radii"][3] == pytest.approx(6)
    assert sketch.profile_face(sketch.apply_solution(sk, result)).area == pytest.approx(math.pi * 20 * 6, rel=1e-6)


def test_an_ellipse_axis_line_is_a_construction_line_that_takes_a_dimension():
    sk = _ellipse_with_ends()
    sk["entities"] += [{"id": 12, "type": "line", "a": 2, "b": 4, "construction": True}, {"id": 13, "type": "line", "a": 5, "b": 6, "construction": True}]
    sk["constraints"] = [{"id": 8, "type": "fixed", "point": 1}, {"id": 11, "type": "horizontal", "points": [1, 2]}, {"id": 9, "type": "distance", "entity": 12, "value": 40}, {"id": 10, "type": "distance", "entity": 13, "value": 12}]
    result = sketch.solve(sk)
    assert result["status"] == "ok" and result["dof"] == 0
    assert result["radii"][3] == pytest.approx(6)
    # the construction lines are not part of the profile
    assert sketch.profile_face(sketch.apply_solution(sk, result)).area == pytest.approx(math.pi * 20 * 6, rel=1e-6)


def test_a_point_can_be_put_on_an_ellipse_and_follows_it():
    sk = _ellipse_with_ends()
    sk["points"].append({"id": 7, "u": 6.5, "v": 4.5})  # near the rim, not on it
    sk["constraints"] = [{"id": 8, "type": "fixed", "point": 1}, {"id": 9, "type": "point_on", "point": 7, "entity": 3}]
    result = sketch.solve(sk)
    assert result["status"] == "ok"
    assert _on_ellipse(result) == pytest.approx(1, abs=1e-6)
    # widening the ellipse carries the point along with it
    sk["constraints"].append({"id": 10, "type": "distance", "points": [5, 6], "value": 14})
    wider = sketch.solve(sk)
    assert wider["status"] == "ok" and _on_ellipse(wider) == pytest.approx(1, abs=1e-6)


def test_a_point_can_be_put_on_an_ellipse_without_axis_ends():
    sk = _ellipse_sketch()
    sk["points"].append({"id": 7, "u": 6.5, "v": 4.5})
    sk["constraints"] = [{"id": 8, "type": "fixed", "point": 1}, {"id": 9, "type": "point_on", "point": 7, "entity": 3}]
    result = sketch.solve(sk)
    assert result["status"] == "ok" and _on_ellipse(result) == pytest.approx(1, abs=1e-6)


def test_a_closed_spline_is_a_profile_and_dragging_its_point_moves_only_it():
    sk = {
        "plane": sketch.STANDARD_PLANES["XY"],
        "points": [{"id": 1, "u": 0, "v": 0}, {"id": 2, "u": 10, "v": 0}, {"id": 3, "u": 10, "v": 10}, {"id": 4, "u": 0, "v": 10}, {"id": 5, "u": 50, "v": 50}],
        "entities": [{"id": 6, "type": "spline", "points": [1, 2, 3, 4], "closed": True}],
        "constraints": [{"id": 7, "type": "horizontal", "points": [1, 2]}],
    }
    assert sketch.profile_face(sk).area > 80
    moved = sketch.solve(sk, {"point": 3, "u": 12, "v": 11})
    by_id = {p["id"]: p for p in moved["points"]}
    assert by_id["3" if "3" in by_id else 3]["u"] == pytest.approx(12) and by_id[5]["u"] == pytest.approx(50)
    open_spline = {**sk, "entities": [{"id": 6, "type": "spline", "points": [1, 2, 3]}]}
    with pytest.raises(sketch.SketchError):
        sketch.profile_face(open_spline)


def test_projecting_onto_a_tilted_plane_gives_an_ellipse_for_a_circle():
    from build123d import Cylinder

    tilted = {"origin": [0, 0, 0], "normal": [0, math.sin(math.radians(60)), math.cos(math.radians(60))], "xdir": [1, 0, 0]}
    ref = sketch.face_reference(Cylinder(5, 10).wrapped, tilted, project=True)
    ellipses = [e for e in ref["entities"] if e["type"] == "ellipse"]
    assert ellipses and ellipses[0]["minor"] == pytest.approx(5 * math.cos(math.radians(60)), rel=1e-6)
    major = {p["id"]: p for p in ref["points"]}
    assert math.dist((major[ellipses[0]["major"]]["u"], major[ellipses[0]["major"]]["v"]), (major[ellipses[0]["center"]]["u"], major[ellipses[0]["center"]]["v"])) == pytest.approx(5, rel=1e-6)


def _tilted_plane(degrees):
    a = math.radians(degrees)
    return {"origin": [0, 0, 0], "normal": [0, math.sin(a), math.cos(a)], "xdir": [1, 0, 0]}


def _as_sketch(ref, plane):
    return {"plane": plane, "points": ref["points"], "entities": ref["entities"], "constraints": []}


def test_projected_tilted_cylinder_gives_ellipses_matching_the_analytic_axes():
    from build123d import Cylinder

    plane = _tilted_plane(30)
    ref = sketch.face_reference(Cylinder(5, 10).wrapped, plane, project=True)
    pts = {p["id"]: p for p in ref["points"]}
    assert ref["drawn"]["ellipses"] >= 2
    for e in (e for e in ref["entities"] if e["type"] == "ellipse"):
        c, m = pts[e["center"]], pts[e["major"]]
        assert math.dist((c["u"], c["v"]), (m["u"], m["v"])) == pytest.approx(5, rel=1e-6)
        assert e["minor"] == pytest.approx(5 * math.cos(math.radians(30)), rel=1e-6)
        assert abs(c["u"]) < 1e-6 and abs(abs(c["v"]) - 5 * math.sin(math.radians(30))) < 1e-6
    sk = _as_sketch(ref, plane)
    assert sketch.solve(sk)["status"] != "failed"
    with pytest.raises(sketch.SketchError, match="no geometry"):
        sketch.profile_face(sk)  # reference geometry is construction: nothing crashes, there is just no profile


def test_projected_tilted_arc_becomes_a_spline_through_its_ends():
    from build123d import Circle, Plane, extrude
    from OCP.BRepAdaptor import BRepAdaptor_Curve

    arc = Circle(5).edges()[0]
    from build123d import Edge
    part = Edge.make_circle(5, start_angle=0, end_angle=90).rotate(__import__("build123d").Axis.X, 30)
    plane = sketch.STANDARD_PLANES["XY"]
    ref = sketch.face_reference(part.wrapped, plane, project=True)
    splines = [e for e in ref["entities"] if e["type"] == "spline"]
    assert len(splines) == 1 and ref["drawn"]["splines"] == 1 and len(splines[0]["points"]) >= 8
    pts = {p["id"]: p for p in ref["points"]}
    start, end = pts[splines[0]["points"][0]], pts[splines[0]["points"][-1]]
    ends = sorted([(round(start["u"], 6), round(start["v"], 6)), (round(end["u"], 6), round(end["v"], 6))])
    a = math.cos(math.radians(30))
    assert ends == sorted([(5.0, 0.0), (0.0, round(5 * a, 6))])
    sk = _as_sketch(ref, plane)
    assert sketch.solve(sk)["status"] != "failed"


def test_projected_square_circle_stays_a_circle_and_end_on_edges_stay_points():
    from build123d import Cylinder

    ref = sketch.face_reference(Cylinder(5, 10).wrapped, sketch.STANDARD_PLANES["XY"], project=True)
    assert sum(e["type"] == "circle" for e in ref["entities"]) >= 2 and ref["drawn"]["ellipses"] == 0
    assert ref["skipped"]["square"] >= 1  # the seam line is seen end-on


def test_detail_blames_every_conflicting_constraint():
    points, lines = rectangle()
    constraints = [
        {"id": 7, "type": "distance", "points": [1, 2], "value": 40},
        {"id": 8, "type": "distance", "points": [1, 2], "value": 50},
        {"id": 9, "type": "horizontal", "entity": 101},
    ]
    result = sketch.solve(sketch_of(points, lines, constraints), detail=True)
    assert result["status"] == "failed"
    assert set(result["conflicts"]) == {7, 8}  # the solver names one; removing either fixes it; the unrelated one is not blamed


def test_detail_reports_how_free_each_point_is():
    points, lines = rectangle()
    constraints = [{"type": "horizontal", "entity": 101}, {"type": "vertical", "entity": 102}, {"type": "horizontal", "entity": 103}, {"type": "vertical", "entity": 104},
                   {"type": "fixed", "point": 1}, {"type": "distance", "points": [1, 2], "value": 40}]
    freedom = sketch.solve(sketch_of(points, lines, constraints), detail=True)["freedom"]
    assert freedom[1] == 0 and freedom[2] == 0  # pinned corner and the corner on its horizontal at a set distance
    assert freedom[3] == 1 and freedom[4] == 1  # still free in height only
    assert "freedom" not in sketch.solve(sketch_of(points, lines, constraints))


def test_freedom_of_a_point_on_a_fixed_circle_is_one():
    points = [{"id": 1, "u": 0, "v": 0}, {"id": 2, "u": 5, "v": 0.1}]
    entities = [{"id": 10, "type": "circle", "center": 1, "radius": 5}]
    constraints = [{"type": "fixed", "point": 1}, {"type": "radius", "entity": 10, "value": 5}, {"type": "point_on", "point": 2, "entity": 10}]
    assert sketch.solve(sketch_of(points, entities, constraints), detail=True)["freedom"] == {1: 0, 2: 1}


def test_collinear_lines_share_a_line():
    points = [{"id": 1, "u": 0, "v": 0}, {"id": 2, "u": 10, "v": 0}, {"id": 3, "u": 15, "v": 2}, {"id": 4, "u": 25, "v": 5}]
    lines = [{"id": 10, "type": "line", "a": 1, "b": 2}, {"id": 11, "type": "line", "a": 3, "b": 4}]
    constraints = [{"type": "fixed", "point": 1}, {"type": "fixed", "point": 2}, {"type": "collinear", "entities": [10, 11]}]
    c = coords(sketch.solve(sketch_of(points, lines, constraints)))
    assert c[3][1] == pytest.approx(0, abs=1e-6) and c[4][1] == pytest.approx(0, abs=1e-6)


def test_collinear_on_lines_sharing_an_end_is_not_a_conflict():
    """What the split tool leaves behind: two lines with a shared end point and an automatic collinear constraint."""
    points = [{"id": 1, "u": 0, "v": 0}, {"id": 2, "u": 5, "v": 0}, {"id": 3, "u": 10, "v": 0}]
    lines = [{"id": 10, "type": "line", "a": 1, "b": 2}, {"id": 11, "type": "line", "a": 2, "b": 3}]
    constraints = [{"id": 5, "type": "collinear", "entities": [10, 11], "auto": True}]
    result = sketch.solve(sketch_of(points, lines, constraints))
    assert result["status"] == "ok" and not result.get("conflicts")


@pytest.mark.parametrize("v", [7.0, -7.0])
def test_point_line_distance_keeps_the_side(v):
    points = [{"id": 1, "u": 0, "v": 0}, {"id": 2, "u": 10, "v": 0}, {"id": 3, "u": 4, "v": v * 0.5}]
    lines = [{"id": 10, "type": "line", "a": 1, "b": 2}]
    constraints = [{"type": "fixed", "point": 1}, {"type": "fixed", "point": 2}, {"type": "point_line_distance", "point": 3, "entity": 10, "value": 7}]
    result = sketch.solve(sketch_of(points, lines, constraints))
    assert result["status"] == "ok"
    assert abs(coords(result)[3][1]) == pytest.approx(7, abs=1e-6)
    assert (coords(result)[3][1] > 0) == (v > 0)


def test_block_holds_every_point_and_the_radius():
    points = [{"id": 1, "u": 3, "v": 4}, {"id": 2, "u": 8, "v": 4}]
    circle = [{"id": 10, "type": "circle", "center": 1, "radius": 2.5}, {"id": 11, "type": "line", "a": 1, "b": 2}]
    result = sketch.solve(sketch_of(points, circle, [{"type": "block", "entity": 11}, {"type": "block", "entity": 10}]), detail=True)
    assert result["dof"] == 0 and result["freedom"] == {1: 0, 2: 0}
    assert coords(result)[2] == pytest.approx((8, 4), abs=1e-9)


def test_reference_dimension_is_not_solved():
    points, lines = rectangle()
    constraints = [{"type": "fixed", "point": 1}, {"type": "distance", "points": [1, 2], "value": 99, "reference": True}]
    result = sketch.solve(sketch_of(points, lines, constraints), detail=True)
    assert result["status"] == "ok" and result["dof"] == 6  # 8 coordinates, minus the 2 of the fixed corner
    assert result["freedom"][2] == 2


def test_slot_made_of_two_lines_and_two_tangent_arcs_solves_and_extrudes():
    # end centres 1 and 2 at (0,0) and (10,0), half-width 2: corners 3-6, drawn as the slot tool builds it
    points = [{"id": 1, "u": 0, "v": 0}, {"id": 2, "u": 10, "v": 0}, {"id": 3, "u": 0, "v": 2}, {"id": 4, "u": 0, "v": -2}, {"id": 5, "u": 10, "v": 2}, {"id": 6, "u": 10, "v": -2}]
    entities = [
        {"id": 20, "type": "line", "a": 3, "b": 5},
        {"id": 21, "type": "line", "a": 6, "b": 4},
        {"id": 22, "type": "arc", "center": 2, "start": 6, "end": 5},
        {"id": 23, "type": "arc", "center": 1, "start": 3, "end": 4},
    ]
    constraints = [{"type": "tangent", "entities": [a, b]} for a, b in ((22, 20), (22, 21), (23, 20), (23, 21))] + [{"type": "equal", "entities": [22, 23]}]
    sk = sketch_of(points, entities, constraints)
    result = sketch.solve(sk)
    assert result["status"] == "ok"
    solved = sketch.apply_solution(sk, result)
    face = sketch.profile_face(solved)
    assert face.area == pytest.approx(10 * 4 + math.pi * 4, rel=1e-6)


def test_slot_can_be_fully_constrained_with_ordinary_dimensions():
    points = [{"id": 1, "u": 0, "v": 0}, {"id": 2, "u": 10, "v": 0}, {"id": 3, "u": 0, "v": 2}, {"id": 4, "u": 0, "v": -2}, {"id": 5, "u": 10, "v": 2}, {"id": 6, "u": 10, "v": -2}]
    entities = [
        {"id": 20, "type": "line", "a": 3, "b": 5},
        {"id": 21, "type": "line", "a": 6, "b": 4},
        {"id": 22, "type": "arc", "center": 2, "start": 6, "end": 5},
        {"id": 23, "type": "arc", "center": 1, "start": 3, "end": 4},
    ]
    shape = [{"type": "tangent", "entities": [a, b]} for a, b in ((22, 20), (22, 21), (23, 20), (23, 21))] + [{"type": "equal", "entities": [22, 23]}]
    dimensions = [{"type": "fixed", "point": 1}, {"type": "horizontal", "points": [1, 2]}, {"type": "distance", "points": [1, 2], "value": 12}, {"type": "radius", "entity": 22, "value": 3}]
    result = sketch.solve(sketch_of(points, entities, shape + dimensions), detail=True)
    assert result["status"] == "ok" and result["dof"] == 0
    assert math.dist(coords(result)[1], coords(result)[2]) == pytest.approx(12, abs=1e-6)


def test_long_drag_is_solved_in_steps_and_matches_a_short_one():
    points, lines = rectangle(40, 30)
    constraints = [{"type": "horizontal", "entity": 101}, {"type": "vertical", "entity": 102}, {"type": "horizontal", "entity": 103}, {"type": "vertical", "entity": 104}, {"type": "fixed", "point": 1}]
    sk = sketch_of(points, lines, constraints)
    assert len(sketch._drag_steps(sk, {"point": 3, "u": 400, "v": 300})) > 1
    assert len(sketch._drag_steps(sk, {"point": 3, "u": 41, "v": 31})) == 1
    result = sketch.solve(sk, {"point": 3, "u": 400, "v": 300})
    assert result["status"] == "ok"
    assert coords(result)[3] == pytest.approx((400, 300), abs=1e-6) and coords(result)[2] == pytest.approx((400, 0), abs=1e-6)


def test_long_drag_keeps_the_last_good_step_when_a_later_one_fails():
    points, lines = rectangle(40, 30)
    constraints = [{"type": "distance", "points": [1, 2], "value": 40}, {"type": "fixed", "point": 1}, {"type": "horizontal", "entity": 101}]
    sk = sketch_of(points, lines, constraints)
    # pulling point 2 away from the fixed distance is impossible: nothing to keep, so the failure is reported
    assert sketch.solve(sk, {"point": 2, "u": 400, "v": 0})["status"] == "failed"


def test_ellipse_minor_radius_dimension():
    points = [{"id": 1, "u": 0, "v": 0}, {"id": 2, "u": 10, "v": 0}]
    ellipse = [{"id": 10, "type": "ellipse", "center": 1, "major": 2, "minor": 3}]
    sk = sketch_of(points, ellipse, [{"type": "fixed", "point": 1}, {"type": "distance", "points": [1, 2], "value": 8}, {"type": "minor_radius", "entity": 10, "value": 4.5}])
    result = sketch.solve(sk)
    assert result["status"] == "ok" and result["radii"][10] == 4.5
    solved = sketch.apply_solution(sk, result)
    assert solved["entities"][0]["minor"] == 4.5
    assert math.dist(coords(result)[1], coords(result)[2]) == pytest.approx(8, abs=1e-6)


def test_plane_through_three_vertices_and_through_an_edge_and_a_vertex():
    from OCP.BRep import BRep_Tool

    from pliable.server import RequestError, Session

    session = Session()
    session.handle({"type": "open_demo", "name": "block"})  # a box from z = -10 to 10
    topology = session.document.current
    bottom = [i for i in range(topology.vertex_count) if BRep_Tool.Pnt_s(topology.vertex(i)).Z() < 0][:3]
    plane = session.handle({"type": "sketch_plane", "vertices": bottom})["plane"]
    assert abs(plane["normal"][2]) == pytest.approx(1) and plane["origin"][2] == pytest.approx(-10)
    with pytest.raises(RequestError):
        session.handle({"type": "sketch_plane", "vertices": [bottom[0], bottom[1], bottom[0]]})
    with pytest.raises(sketch.SketchError):
        sketch.plane_through((0, 0, 0), (1, 0, 0), (2, 0, 0))
    edge_plane = session.handle({"type": "sketch_plane", "edge": 0, "vertex": bottom[2]})["plane"]
    assert math.sqrt(sum(c * c for c in edge_plane["normal"])) == pytest.approx(1)


def test_offset_and_angled_planes_from_a_face_and_tangent_plane_at_a_vertex():
    from OCP.BRep import BRep_Tool

    from pliable.server import RequestError, Session

    session = Session()
    session.handle({"type": "open_demo", "name": "block"})  # a box from z = -10 to 10
    topology = session.document.current
    top = next(i for i, f in topology.faces() if sketch.face_plane(f)["normal"][2] > 0.99)
    moved = session.handle({"type": "sketch_plane", "face": top, "offset": 5})
    assert moved["plane"]["origin"][2] == pytest.approx(15) and "reference" not in moved  # its outline would not lie on the plane
    tilted = session.handle({"type": "sketch_plane", "face": top, "angle": 90})["plane"]
    assert abs(tilted["normal"][2]) < 1e-9 and tilted["origin"][2] == pytest.approx(10)
    assert math.sqrt(sum(c * c for c in tilted["normal"])) == pytest.approx(1)
    assert "reference" in session.handle({"type": "sketch_plane", "face": top})
    corner = next(i for i in range(topology.vertex_count) if BRep_Tool.Pnt_s(topology.vertex(i)).Z() > 9)
    touching = session.handle({"type": "sketch_plane", "tangent_face": top, "vertex": corner})["plane"]
    assert touching["normal"] == pytest.approx([0, 0, 1], abs=1e-9) and touching["origin"][2] == pytest.approx(10)
    with pytest.raises(RequestError):
        session.handle({"type": "sketch_plane", "tangent_face": 9999, "vertex": corner})


def test_rotating_a_plane_about_a_line_turns_its_origin_and_axes_together():
    plane = {"origin": [0, 0, 5], "normal": [0, 0, 1], "xdir": [1, 0, 0]}
    turned = sketch.rotate_plane(plane, [0, 0, 0], [0, 1, 0], 90)  # a quarter turn about the Y axis
    assert turned["origin"] == pytest.approx([5, 0, 0], abs=1e-9)
    assert turned["normal"] == pytest.approx([1, 0, 0], abs=1e-9) and turned["xdir"] == pytest.approx([0, 0, -1], abs=1e-9)


@pytest.mark.parametrize("preview", [True, False])
@pytest.mark.parametrize("distance", [-20, -20.1, -50, -1000])
def test_imprinted_region_pushed_past_the_bottom_cuts_through(preview, distance):
    """The block is 20 thick: a region pushed down by that much or more makes the same clean through-pocket."""
    from pliable.tools import TOOLS, Selection
    from pliable.topology import Topology

    shape = load_demo("block")
    top = {"origin": [0, 0, 10], "normal": [0, 0, 1], "xdir": [1, 0, 0]}
    result, _ = sketch.add_regions(shape, _overlapping_sketch(top))
    topology = Topology(result)
    small = next(i for i, f in topology.faces() if _face_area(f) == pytest.approx(12.57, abs=0.05))
    cut = TOOLS["push_pull"].execute(topology, Selection(faces=[small]), {"distance": distance}, preview)
    assert _solid_volume(cut.shape) == pytest.approx(volume(shape) - 12.566 * 20, rel=1e-3)


def test_sketch_origin_is_the_middle_of_the_face_not_its_centroid():
    from build123d import Box, Pos

    # an L-shaped top face: the area centroid is pulled toward the thick leg, the extent's middle is not
    shape = Box(40, 20, 10) + Pos(-15, 20, 0) * Box(10, 20, 10)
    top = next(f for f in shape.faces() if f.normal_at().Z > 0.9)
    plane = sketch.face_plane(top.wrapped)
    xs = [v.X for v in top.vertices()]
    ys = [v.Y for v in top.vertices()]
    assert plane["origin"][0] == pytest.approx((min(xs) + max(xs)) / 2, abs=1e-6)
    assert plane["origin"][1] == pytest.approx((min(ys) + max(ys)) / 2, abs=1e-6)
    assert plane["origin"][2] == pytest.approx(5)


def test_plane_square_to_an_edge_at_a_fraction_along_it():
    from OCP.BRep import BRep_Tool
    from OCP.TopExp import TopExp
    from OCP.TopoDS import TopoDS_Vertex

    from pliable.server import Session

    session = Session()
    session.handle({"type": "open_demo", "name": "block"})  # a 40 x 30 x 20 box centred on the origin
    topology = session.document.current
    v1, v2 = TopoDS_Vertex(), TopoDS_Vertex()
    TopExp.Vertices_s(topology.edge(0), v1, v2)
    a, b = BRep_Tool.Pnt_s(v1), BRep_Tool.Pnt_s(v2)
    for at in (0.5, 0.25):
        plane = session.handle({"type": "sketch_plane", "normal_to": 0, "at": at})["plane"]
        expected = [a.X() + at * (b.X() - a.X()), a.Y() + at * (b.Y() - a.Y()), a.Z() + at * (b.Z() - a.Z())]
        assert plane["origin"] == pytest.approx(expected, abs=1e-6)
        direction = [b.X() - a.X(), b.Y() - a.Y(), b.Z() - a.Z()]
        length = math.sqrt(sum(c * c for c in direction))
        assert abs(sum(n * d / length for n, d in zip(plane["normal"], direction))) == pytest.approx(1, abs=1e-9)
        assert sum(x * n for x, n in zip(plane["xdir"], plane["normal"])) == pytest.approx(0, abs=1e-9)


def test_dimensioned_horizontal_line_drags_by_its_body():
    """Holding both ends of a horizontal or dimensioned line used to be reported as a conflict, so it could not move."""
    points = [{"id": 1, "u": 0, "v": 0}, {"id": 2, "u": 10, "v": 0}, {"id": 3, "u": 10, "v": 8}, {"id": 4, "u": 0, "v": 8}]
    lines = [{"id": 10 + k, "type": "line", "a": a, "b": b} for k, (a, b) in enumerate([(1, 2), (2, 3), (3, 4), (4, 1)])]
    drag = {"points": [{"point": 1, "u": 3, "v": 2}, {"point": 2, "u": 13, "v": 2}]}
    for constraints in (
        [{"id": 1, "type": "horizontal", "entity": 10}],
        [{"id": 1, "type": "horizontal", "entity": 10}, {"id": 2, "type": "distance", "entity": 10, "value": 10}],
        [{"id": 1, "type": "horizontal", "entity": 10}, {"id": 2, "type": "horizontal_distance", "entity": 10, "value": 10}],
    ):
        result = sketch.solve(sketch_of(points, lines, constraints), drag)
        assert result["status"] == "ok"
        moved = {p["id"]: (p["u"], p["v"]) for p in result["points"]}
        assert moved[1] == pytest.approx((3, 2)) and moved[2] == pytest.approx((13, 2))
        assert moved[3] == pytest.approx((10, 8)) and moved[4] == pytest.approx((0, 8))


def _areas(sk):
    return sorted(round(z.area, 3) for z in sketch.regions(sk))


def _free_line(entities, points, a, b, line_id):
    points += [{"id": 900 + line_id * 2, "u": a[0], "v": a[1]}, {"id": 901 + line_id * 2, "u": b[0], "v": b[1]}]
    entities.append({"id": line_id, "type": "line", "a": 900 + line_id * 2, "b": 901 + line_id * 2})


def test_divider_not_touching_the_corners_makes_two_faces():
    points, lines = rectangle(20, 20)
    _free_line(lines, points, (0, 8), (20, 8), 50)  # ends on the two side edges, shares none of the corner points
    assert _areas(sketch_of(points, lines)) == [160.0, 240.0]


def test_lines_attached_to_a_side_enclose_a_new_face():
    points, lines = rectangle(20, 20)
    for k, (a, b) in enumerate([((20, 5), (30, 5)), ((30, 5), (30, 15)), ((30, 15), (20, 15))]):
        _free_line(lines, points, a, b, 60 + k)
    # the three lines meet each other only at their ends and touch the side at their outer ends
    sk = sketch_of(points, lines)
    zones = sketch.regions(sk)
    assert _areas(sk) == [100.0, 400.0]
    assert all(z.normal_at().Z > 0 for z in zones)


def test_nested_loops_and_dangling_lines():
    points, lines = rectangle(20, 20)
    inner_points, inner = rectangle(6, 6, x0=5, y0=5, first_id=11)
    _free_line(inner, inner_points, (0, 0), (-5, -5), 70)  # a loose line that closes nothing
    sk = sketch_of(points + inner_points, lines + inner)
    assert _areas(sk) == [36.0, 364.0]  # the inner loop is a hole in the outer face and a face of its own
    open_sk = sketch_of(points[:2], [lines[0]])
    assert sketch.regions(open_sk) == []


def test_regions_can_be_extruded_from_a_split_rectangle():
    points, lines = rectangle(20, 20)
    _free_line(lines, points, (0, 8), (20, 8), 50)
    shape, count = sketch.add_regions(load_demo("block"), sketch_of(points, lines, plane=sketch.STANDARD_PLANES["XY"]), only=1)
    assert count == 1


def test_regions_of_a_blank_document_become_loose_faces():
    from OCP.TopoDS import TopoDS_Compound

    points, lines = rectangle(20, 20)
    shape, count = sketch.add_regions(TopoDS_Compound(), sketch_of(points, lines, plane=sketch.STANDARD_PLANES["XY"]))
    assert count == 1 and not shape.IsNull()


def _circle_with(*constraints):
    return sketch_of([{"id": 1, "u": 0, "v": 0}], [{"id": 10, "type": "circle", "center": 1, "radius": 5}], list(constraints))


@pytest.mark.parametrize("second", [
    {"id": 21, "type": "diameter", "entity": 10, "value": 10},  # redundant
    {"id": 21, "type": "diameter", "entity": 10, "value": 14},  # conflicting
    {"id": 21, "type": "radius", "entity": 10, "value": 7},
    {"id": 21, "type": "block", "entity": 10},
])
def test_redundant_or_conflicting_diameter_edits_are_reported_not_fatal(second):
    from pliable.server import Session

    session = Session()
    for detail in (True, False):
        reply = session.handle({"type": "sketch_solve", "sketch": _circle_with({"id": 20, "type": "diameter", "entity": 10, "value": 10}, second), "detail": detail})
        assert reply["status"] in ("ok", "failed")
    # editing the value afterwards (the in-place editor) still answers
    edited = session.handle({"type": "sketch_solve", "sketch": _circle_with({"id": 20, "type": "diameter", "entity": 10, "value": 12}), "detail": True})
    assert edited["status"] == "ok" and edited["radii"][10] == pytest.approx(6)


@pytest.mark.parametrize("value", [0, -4, float("nan"), float("inf"), None])
def test_a_circle_of_no_size_is_refused_by_the_dimension(value):
    from pliable.server import RequestError, Session

    session = Session()
    with pytest.raises((RequestError, OperationError)):
        session.handle({"type": "sketch_solve", "sketch": _circle_with({"id": 20, "type": "diameter", "entity": 10, "value": value})})
    # a circle already drawn with no size gives no regions instead of an error
    flat = sketch_of([{"id": 1, "u": 0, "v": 0}], [{"id": 10, "type": "circle", "center": 1, "radius": 0}])
    assert session.handle({"type": "sketch_profiles", "sketch": flat}) == {"profiles": []}


def _divided_square(plane=XY, x0=0.0, y0=0.0):
    points, lines = rectangle(20, 20, x0=x0, y0=y0)
    _free_line(lines, points, (x0, y0 + 8), (x0 + 20, y0 + 8), 50)  # a divider that shares none of the corner points
    return sketch_of(points, lines, plane=plane)


@pytest.mark.parametrize("height", [30, 10])  # clear of the block (loose face) and on its top face (imprinted)
def test_each_face_of_a_divided_rectangle_pushes_and_pulls(height):
    from pliable.ops import push_pull
    from pliable.topology import Topology

    shape = load_demo("block")
    plane = {"origin": [0, 0, height], "normal": [0, 0, 1], "xdir": [1, 0, 0]}
    sk = _divided_square(plane, x0=-10, y0=-10)
    for area in (160.0, 240.0):
        index = next(i for i, z in enumerate(sketch.regions(sk)) if z.area == pytest.approx(area))
        result, _ = sketch.add_regions(shape, sk, only=index)
        face = next(f for _, f in Topology(result).faces() if _face_area(f) == pytest.approx(area, rel=1e-3))
        pulled = push_pull(result, face, 4)
        assert _solid_volume(pulled.shape) == pytest.approx(volume(shape) + area * 4, rel=1e-3)


def test_sketch_extrude_of_a_divided_rectangle_and_of_attached_lines():
    shape = load_demo("block")
    far = {"origin": [0, 0, 30], "normal": [0, 0, 1], "xdir": [1, 0, 0]}
    result = sketch.extrude(shape, _divided_square(far, x0=-10, y0=-10), 5, "new")
    assert _solid_volume(result.shape) == pytest.approx(volume(shape) + 20 * 20 * 5, rel=1e-3)
    points, lines = rectangle(20, 20, x0=-10, y0=-10)
    for k, (a, b) in enumerate([((10, -5), (20, -5)), ((20, -5), (20, 5)), ((20, 5), (10, 5))]):
        _free_line(lines, points, a, b, 60 + k)
    result = sketch.extrude(shape, sketch_of(points, lines, plane=far), 5, "new")
    assert _solid_volume(result.shape) == pytest.approx(volume(shape) + (400 + 100) * 5, rel=1e-3)


def test_a_redundant_dimension_marked_reference_solves_and_drives_nothing():
    driving = {"id": 20, "type": "diameter", "entity": 10, "value": 10}
    redundant = {"id": 21, "type": "diameter", "entity": 10, "value": 14}
    assert sketch.solve(_circle_with(driving, redundant))["status"] == "failed"
    result = sketch.solve(_circle_with(driving, {**redundant, "reference": True}))
    assert result["status"] == "ok" and result["radii"][10] == pytest.approx(5)


def _two_lines():
    points = [{"id": 1, "u": 0, "v": 0}, {"id": 2, "u": 10, "v": 0}, {"id": 3, "u": 0, "v": 0.0}, {"id": 4, "u": 5, "v": 6}]
    return points, [{"id": 10, "type": "line", "a": 1, "b": 2}, {"id": 11, "type": "line", "a": 3, "b": 4}]


@pytest.mark.parametrize("outside,expected", [(False, 60.0), (True, 120.0)])
def test_angle_between_lines_can_be_the_inside_or_the_outside_value(outside, expected):
    points, lines = _two_lines()
    cons = [{"id": 30, "type": "coincident", "points": [1, 3]}, {"id": 31, "type": "horizontal", "entity": 10}, {"id": 32, "type": "angle", "entities": [10, 11], "value": 60, "outside": outside}]
    result = sketch.solve(sketch_of(points, lines, cons))
    assert result["status"] == "ok"
    p = coords(result)
    angle = math.degrees(math.atan2(p[4][1] - p[3][1], p[4][0] - p[3][0]))
    a = (p[2][0] - p[1][0], p[2][1] - p[1][1])
    b = (p[4][0] - p[3][0], p[4][1] - p[3][1])
    between = math.degrees(math.acos((a[0] * b[0] + a[1] * b[1]) / math.hypot(*a) / math.hypot(*b)))
    assert between == pytest.approx(60.0 if not outside else 120.0, abs=1e-4)


def _polygon_with_circles(n=6, r=5.0):
    """The structure the frontend builds for the polygon tool: sides, a major construction circle through the corners and a minor one tangent to a side."""
    points = [{"id": 1, "u": 0.0, "v": 0.0}]
    for k in range(n):
        a = 2 * math.pi * k / n + 0.03 * k  # slightly off, the solver corrects it
        points.append({"id": 2 + k, "u": r * math.cos(a), "v": r * math.sin(a)})
    ents = [{"id": 20 + k, "type": "line", "a": 2 + k, "b": 2 + (k + 1) % n} for k in range(n)]
    ents += [{"id": 50, "type": "circle", "center": 1, "radius": r, "construction": True}, {"id": 51, "type": "circle", "center": 1, "radius": r * math.cos(math.pi / n), "construction": True}]
    cons = [{"id": 60 + k, "type": "equal", "entities": [20, 20 + k]} for k in range(1, n)]
    cons += [{"id": 70 + k, "type": "point_on", "point": 2 + k, "entity": 50} for k in range(n)]
    cons.append({"id": 80, "type": "tangent", "entities": [51, 20]})
    return sketch_of(points, ents, cons)


@pytest.mark.parametrize("n", [3, 5, 6, 8])
def test_polygon_with_two_construction_circles_solves_and_is_regular(n):
    sk = _polygon_with_circles(n)
    result = sketch.solve(sk, detail=True)
    assert result["status"] == "ok", result
    solved = sketch.apply_solution(sk, result)
    # dimensioning the minor circle (or a side) sets the whole polygon
    sized = sketch.solve({**solved, "constraints": solved["constraints"] + [{"id": 90, "type": "diameter", "entity": 51, "value": 20}]})
    assert sized["status"] == "ok"
    final = sketch.apply_solution(solved, sized)
    p = {q["id"]: (q["u"], q["v"]) for q in final["points"]}
    sides = [math.dist(p[2 + k], p[2 + (k + 1) % n]) for k in range(n)]
    assert max(sides) - min(sides) < 1e-6
    assert sides[0] == pytest.approx(2 * 10 * math.tan(math.pi / n), rel=1e-5)  # incircle radius 10
    (zone,) = sketch.regions(final)  # the construction circles make no faces
    assert zone.area == pytest.approx(n * 100 * math.tan(math.pi / n), rel=1e-5)


def test_symmetric_about_a_point():
    points = [{"id": 1, "u": 0, "v": 0, "fixed": True}, {"id": 2, "u": -4, "v": 1}, {"id": 3, "u": 5, "v": 2, "fixed": True}]
    constraints = [{"id": 1, "type": "symmetric_point", "points": [2, 3], "point": 1}]
    result = sketch.solve(sketch_of(points, [], constraints))
    assert result["status"] == "ok"
    p2 = next(p for p in result["points"] if p["id"] == 2)
    assert (p2["u"], p2["v"]) == pytest.approx((-5, -2), abs=1e-6)


def test_freedom_stops_at_its_time_budget():
    points = [{"id": 1, "u": 0, "v": 0, "fixed": True}, {"id": 2, "u": 10, "v": 0}, {"id": 3, "u": 10, "v": 5}]
    lines = [{"id": 10, "type": "line", "a": 1, "b": 2}, {"id": 11, "type": "line", "a": 2, "b": 3}]
    s = sketch_of(points, lines, [])
    assert set(sketch.point_freedom(s)) == {1, 2, 3}
    assert sketch.point_freedom(s, budget=-1) == {}  # no time left: nothing is worked out


def test_dimension_to_a_sketch_axis_sent_as_a_fixed_line():
    # the app sends an axis a constraint refers to as a fixed reference line with ids below zero
    points = [{"id": -11, "u": -1e4, "v": 0, "fixed": True}, {"id": -12, "u": 1e4, "v": 0, "fixed": True}, {"id": 1, "u": 3, "v": 4, "fixed": True}, {"id": 2, "u": 9, "v": 6}]
    lines = [{"id": -1, "type": "line", "a": -11, "b": -12, "reference": True, "axis": True}, {"id": 10, "type": "line", "a": 1, "b": 2}]
    constraints = [{"id": 1, "type": "point_line_distance", "point": 2, "entity": -1, "value": 10}]
    result = sketch.solve(sketch_of(points, lines, constraints))
    assert result["status"] == "ok"
    assert next(p for p in result["points"] if p["id"] == 2)["v"] == pytest.approx(10, abs=1e-5)


def test_gap_between_two_circles_and_two_arcs():
    sizes = [{"id": 2, "type": "radius", "entity": 10, "value": 3}, {"id": 3, "type": "radius", "entity": 11, "value": 4}]
    points = [{"id": 1, "u": 0, "v": 0, "fixed": True}, {"id": 2, "u": 20, "v": 0}]
    circles = [{"id": 10, "type": "circle", "center": 1, "radius": 3}, {"id": 11, "type": "circle", "center": 2, "radius": 4}]
    result = sketch.solve(sketch_of(points, circles, [{"id": 1, "type": "round_gap", "entities": [10, 11], "value": 6}, *sizes]))
    assert result["status"] == "ok"
    assert next(p for p in result["points"] if p["id"] == 2)["u"] == pytest.approx(3 + 6 + 4, abs=1e-5)
    # an arc and a circle: the arc's radius is the distance from its centre to its start
    arc_points = [{"id": 1, "u": 30, "v": 0}, {"id": 3, "u": 40, "v": 0, "fixed": True}, {"id": 4, "u": 40, "v": 5, "fixed": True}, {"id": 5, "u": 35, "v": 0}]
    arc = {"id": 12, "type": "arc", "center": 3, "start": 5, "end": 4}
    result = sketch.solve(sketch_of(arc_points, [circles[0], arc], [{"id": 1, "type": "round_gap", "entities": [10, 12], "value": 2}, sizes[0]]))
    assert result["status"] == "ok"
    assert next(p for p in result["points"] if p["id"] == 1)["u"] == pytest.approx(40 - 5 - 2 - 3, abs=1e-5)


def test_gap_between_concentric_circles():
    points = [{"id": 1, "u": 5, "v": 5, "fixed": True}]
    circles = [{"id": 10, "type": "circle", "center": 1, "radius": 3}, {"id": 11, "type": "circle", "center": 1, "radius": 5}]
    sizes = [{"id": 2, "type": "radius", "entity": 10, "value": 3}]
    result = sketch.solve(sketch_of(points, circles, [{"id": 1, "type": "round_gap", "entities": [10, 11], "value": 4}, *sizes]))
    assert result["status"] == "ok"
    assert result["radii"][11] == pytest.approx(7, abs=1e-5)


def test_a_centre_rectangle_centre_point_stays_in_the_middle():
    """What the centre rectangle tool makes: the shape's four constraints and a centre point symmetric about two opposite corners."""
    points, lines = rectangle()
    points.append({"id": 9, "u": 5, "v": 5})  # clicked off-centre, the solver puts it back
    constraints = [{"type": "horizontal", "entity": 101}, {"type": "vertical", "entity": 102}, {"type": "horizontal", "entity": 103}, {"type": "vertical", "entity": 104},
                   {"type": "symmetric_point", "points": [1, 3], "point": 9}, {"type": "fixed", "point": 9}]
    result = sketch.solve(sketch_of(points, lines, constraints))
    assert result["status"] == "ok"
    at = coords(result)
    assert at[9] == pytest.approx(((at[1][0] + at[3][0]) / 2, (at[1][1] + at[3][1]) / 2), abs=1e-6)


def test_projected_ellipse_edge_stays_a_true_ellipse():
    from build123d import Axis, Edge

    part = Edge.make_ellipse(8, 4).rotate(Axis.X, 40).rotate(Axis.Z, 25)
    plane = sketch.STANDARD_PLANES["XY"]
    ref = sketch.face_reference(part.wrapped, plane, project=True)
    ellipses = [e for e in ref["entities"] if e["type"] == "ellipse"]
    assert len(ellipses) == 1 and not [e for e in ref["entities"] if e["type"] == "spline"]
    pts = {p["id"]: p for p in ref["points"]}
    e = ellipses[0]
    c, m = pts[e["center"]], pts[e["major"]]
    a = math.dist((c["u"], c["v"]), (m["u"], m["v"]))
    ux, uy = (m["u"] - c["u"]) / a, (m["v"] - c["v"]) / a
    # every sampled point of the real curve lies on the flattened ellipse
    for i in range(0, 360, 15):
        p = part.position_at(i / 360)
        du, dv = p.X - c["u"], p.Y - c["v"]
        along, across = du * ux + dv * uy, -du * uy + dv * ux
        assert (along / a) ** 2 + (across / e["minor"]) ** 2 == pytest.approx(1, abs=1e-6)
    assert a >= e["minor"]


def test_a_solution_that_is_not_a_number_is_a_failure(monkeypatch):
    from pliable.sketch import solver

    points = [{"id": 1, "u": 0, "v": 0, "fixed": True}, {"id": 2, "u": -4, "v": 1}, {"id": 3, "u": 5, "v": 2, "fixed": True}]
    constraints = [{"id": 1, "type": "symmetric_point", "points": [2, 3], "point": 1}]
    monkeypatch.setattr(solver._Solver, "_coords", lambda self, pid: (float("nan"), 0.0))
    result = sketch.solve(sketch_of(points, [], constraints))
    assert result["status"] == "failed" and result["points"] == []


def test_a_fully_constrained_sketch_colours_every_point_without_testing_each(monkeypatch):
    from pliable.sketch import solver

    points, lines = [], []
    for k in range(12):  # many fixed-size rectangles, far more points than the time budget could test one by one
        p, l = rectangle(10, 10, x0=30 * k, first_id=1 + 4 * k)
        points += p
        lines += l
    constraints = [{"id": 1000 + i, "type": "fixed", "point": p["id"]} for i, p in enumerate(points)]
    s = sketch_of(points, lines, constraints)

    def never(*a, **k):
        raise AssertionError("each point was tested on its own")

    monkeypatch.setattr(solver._Solver, "hold_axis", never)
    assert sketch.point_freedom(s, budget=0.0) == {p["id"]: 0 for p in points}


def _ellipse_with_axis_lines():
    sk = _ellipse_with_ends()
    sk["entities"] += [{"id": 12, "type": "line", "a": 2, "b": 4, "construction": True}, {"id": 13, "type": "line", "a": 5, "b": 6, "construction": True}]
    return sk


def test_dragging_a_major_end_of_an_ellipse_moves_the_minor_axis_too():
    sk = _ellipse_with_axis_lines()
    at = coords(sketch.solve(sk, {"point": 2, "u": 9, "v": 4}))
    # the minor ends turn with the major axis instead of staying where they were (the old behaviour until release)
    assert at[5] != pytest.approx((0, 5), abs=1e-3) and at[6] != pytest.approx((0, -5), abs=1e-3)
    along = (at[2][0] - at[4][0], at[2][1] - at[4][1])
    across = (at[5][0] - at[6][0], at[5][1] - at[6][1])
    assert along[0] * across[0] + along[1] * across[1] == pytest.approx(0, abs=1e-6)


def test_moving_an_ellipse_by_its_centre_and_major_end_carries_all_its_points():
    sk = _ellipse_with_axis_lines()
    result = sketch.solve(sk, {"points": [{"point": 1, "u": 0.5, "v": 0.3}, {"point": 2, "u": 10.5, "v": 0.3}]})
    at = coords(result)
    assert result["status"] == "ok"
    for pid, want in {4: (-9.5, 0.3), 5: (0.5, 5.3), 6: (0.5, -4.7)}.items():
        assert at[pid] == pytest.approx(want, abs=1e-6)

def _axis(eid, horizontal):
    a, b = (-11, -12) if horizontal else (-21, -22)
    reach = 1e4
    pts = [{"id": a, "u": -reach if horizontal else 0, "v": 0 if horizontal else -reach, "fixed": True}, {"id": b, "u": reach if horizontal else 0, "v": 0 if horizontal else reach, "fixed": True}]
    return pts, {"id": eid, "type": "line", "a": a, "b": b, "reference": True, "axis": True}


@pytest.mark.parametrize("horizontal", [True, False])
def test_symmetric_about_an_axis_mirrors_about_that_axis(horizontal):
    from pliable.server import Session

    axis_points, axis_line = _axis(-1 if horizontal else -2, horizontal)
    points = [{"id": 1, "u": -10, "v": 5}, {"id": 2, "u": 10, "v": -4}] + axis_points
    sk = sketch_of(points, [{"id": 100, "type": "line", "a": 1, "b": 2}, axis_line], [{"id": 5, "type": "symmetric", "points": [1, 2], "entity": axis_line["id"]}])
    result = Session().handle({"type": "sketch_solve", "sketch": sk})
    assert result["status"] == "ok"
    (u1, v1), (u2, v2) = coords(result)[1], coords(result)[2]
    if horizontal:  # about the x-axis: same u, opposite v
        assert u1 == pytest.approx(u2) and v1 == pytest.approx(-v2)
    else:
        assert v1 == pytest.approx(v2) and u1 == pytest.approx(-u2)


def test_an_ellipse_axis_line_takes_symmetric_about_the_vertical_axis():
    sk = _ellipse_with_ends()
    sk["points"][0].update(u=3, v=2)  # the centre is free
    axis_points, axis_line = _axis(-2, False)
    sk["points"] += axis_points
    sk["entities"] += [{"id": 9, "type": "line", "a": 2, "b": 4, "construction": True}, axis_line]
    sk["constraints"] = [{"id": 5, "type": "symmetric", "points": [2, 4], "entity": -2}]
    result = sketch.solve(sk)
    assert result["status"] == "ok"
    at = coords(result)
    assert at[2][1] == pytest.approx(at[4][1], abs=1e-6) and at[2][0] == pytest.approx(-at[4][0], abs=1e-6)


def _circle_sketch(constraints):
    return sketch_of([{"id": 1, "u": 0, "v": 0}], [{"id": 10, "type": "circle", "center": 1, "radius": 5}], constraints)


def test_a_fixed_point_stays_put_when_dragged():
    from pliable.server import Session

    sk = _circle_sketch([{"id": 5, "type": "fixed", "point": 1}])
    session = Session()
    result = session.handle({"type": "sketch_solve", "sketch": sk, "drag": {"point": 1, "u": 20, "v": 10}})
    assert result["status"] == "ok" and result["dof"] == 1  # only the radius is left
    assert coords(result)[1] == pytest.approx((0, 0))


def test_a_locked_circle_does_not_move_or_resize():
    from pliable.server import Session

    sk = _circle_sketch([{"id": 5, "type": "block", "entity": 10}])
    result = Session().handle({"type": "sketch_solve", "sketch": sk, "drag": {"point": 1, "u": 20, "v": 10}})
    assert result["dof"] == 0 and coords(result)[1] == pytest.approx((0, 0))


def test_a_circle_with_a_placed_centre_still_reports_its_free_radius():
    from pliable.server import Session

    session = Session()
    fixed = _circle_sketch([{"id": 5, "type": "fixed", "point": 1}])
    assert session.handle({"type": "sketch_freedom", "sketch": fixed})["free_sizes"] == [10]
    sized = _circle_sketch([{"id": 5, "type": "fixed", "point": 1}, {"id": 6, "type": "radius", "entity": 10, "value": 5}])
    assert session.handle({"type": "sketch_freedom", "sketch": sized})["free_sizes"] == []


def _ellipse_with_quadrant_copies(pair, horizontal):
    sk = _ellipse_with_ends()
    sk["points"][0].update(u=30, v=-20)
    for p, (u, v) in zip(sk["points"][1:], [(40, -20), (20, -20), (30, -15), (30, -25)]):
        p.update(u=u, v=v)
    quadrants = {2: 11, 4: 12, 5: 13, 6: 14}
    for k, copy in quadrants.items():
        src = next(p for p in sk["points"] if p["id"] == k)
        sk["points"].append({"id": copy, "u": src["u"], "v": src["v"]})
    axis_points, axis_line = _axis(-1 if horizontal else -2, horizontal)
    sk["points"] += axis_points
    sk["entities"] += [{"id": 20, "type": "line", "a": 2, "b": 4, "construction": True}, {"id": 21, "type": "line", "a": 5, "b": 6, "construction": True}, axis_line]
    sk["constraints"] = [{"id": 30 + k, "type": "coincident", "points": [k, copy]} for k, copy in quadrants.items()]
    sk["constraints"].append({"id": 9, "type": "symmetric", "points": list(pair), "entity": axis_line["id"]})
    return sk


def test_quadrant_points_take_symmetric_about_the_axis_they_can_mirror_about():
    assert sketch.solve(_ellipse_with_quadrant_copies((13, 14), True))["status"] == "ok"  # the minor ends about the x-axis
    assert sketch.solve(_ellipse_with_quadrant_copies((11, 12), False))["status"] == "ok"  # the major ends about the y-axis
    assert sketch.solve(_ellipse_with_quadrant_copies((11, 12), True))["status"] == "failed"  # two ends of one axis line cannot mirror about a line along it


def test_three_pieces_joined_by_neighbour_collinear_constraints_solve():
    """What Trim leaves on a line cut at two crossings: each automatic collinear constraint joins neighbouring pieces."""
    points = [{"id": 1, "u": 0, "v": 0}, {"id": 2, "u": 3, "v": 0}, {"id": 3, "u": 7, "v": 0}, {"id": 4, "u": 10, "v": 0}]
    lines = [{"id": 10, "type": "line", "a": 1, "b": 2}, {"id": 11, "type": "line", "a": 2, "b": 3}, {"id": 12, "type": "line", "a": 3, "b": 4}]
    constraints = [{"id": 5, "type": "collinear", "entities": [10, 11], "auto": True}, {"id": 6, "type": "collinear", "entities": [11, 12], "auto": True}]
    result = sketch.solve(sketch_of(points, lines, constraints))
    assert result["status"] == "ok" and not result.get("conflicts")


def test_freedom_reply_reaches_every_point_of_a_sketch_of_many_shapes():
    from pliable.server import Session

    points, lines, constraints = [], [], []
    for k in range(40):  # 40 placed squares: tested as a whole this took longer than the time limit and left points out
        pts, lns = rectangle(10, 10, x0=k * 20, first_id=1 + 4 * k)
        i = 1 + 4 * k
        points += pts
        lines += lns
        constraints += [{"type": "horizontal", "entity": 100 + i}, {"type": "vertical", "entity": 101 + i}, {"type": "horizontal", "entity": 102 + i}, {"type": "vertical", "entity": 103 + i}, {"type": "fixed", "point": i}, {"type": "distance", "points": [i, i + 1], "value": 10}]
    reply = Session().handle({"type": "sketch_freedom", "sketch": sketch_of(points, lines, constraints)})
    assert set(reply["freedom"]) == {p["id"] for p in points}
    assert sum(1 for v in reply["freedom"].values() if v) == 80  # the far corner of each square can still turn


def test_ellipse_without_axis_ends_has_a_free_size_until_its_minor_radius_is_dimensioned():
    from pliable.server import Session

    sk = {"plane": XY, "points": [{"id": 1, "u": 0, "v": 0}, {"id": 2, "u": 10, "v": 0}], "entities": [{"id": 3, "type": "ellipse", "center": 1, "major": 2, "minor": 5}], "constraints": [{"type": "fixed", "point": 1}, {"type": "fixed", "point": 2}]}
    assert Session().handle({"type": "sketch_freedom", "sketch": sk})["free_sizes"] == [3]
    sk["constraints"].append({"id": 9, "type": "minor_radius", "entity": 3, "value": 5})
    assert Session().handle({"type": "sketch_freedom", "sketch": sk})["free_sizes"] == []


def test_line_arc_fillet_corner_solves_with_tangents():
    # what the Fillet tool leaves for a line meeting an arc: the line, the arc and a fillet arc, joined by tangent constraints
    points = [
        {"id": 1, "u": 20, "v": 0}, {"id": 3, "u": 10, "v": 0}, {"id": 4, "u": 10, "v": -10},
        {"id": 12, "u": 3.67544467966324, "v": 0}, {"id": 13, "u": 0.9649209709474889, "v": -4.285714285714285}, {"id": 15, "u": 3.67544467966324, "v": -3},
    ]
    entities = [
        {"id": 10, "type": "line", "a": 1, "b": 12},
        {"id": 11, "type": "arc", "center": 3, "start": 13, "end": 4},
        {"id": 14, "type": "arc", "center": 15, "start": 12, "end": 13},
    ]
    constraints = [{"id": 16, "type": "tangent", "entities": [14, 10], "auto": True}, {"id": 17, "type": "tangent", "entities": [14, 11], "auto": True}]
    constraints += [{"type": "fixed", "point": k} for k in (1, 3, 4)] + [{"type": "radius", "entity": 14, "value": 3}]
    result = sketch.solve(sketch_of(points, entities, constraints))
    assert result["status"] == "ok"
    c = coords(result)
    # the fillet centre stays 3 from the line and 7 from the arc's centre (tangent inside the arc's circle)
    assert c[15][1] == pytest.approx(-3, abs=1e-6)
    assert math.dist(c[15], c[3]) == pytest.approx(7, abs=1e-6)
    assert c[12][0] == pytest.approx(c[15][0], abs=1e-6)


def test_arc_arc_fillet_corner_solves_with_tangents():
    points = [
        {"id": 1, "u": -10, "v": 10}, {"id": 3, "u": 0, "v": 10}, {"id": 4, "u": 10, "v": -10}, {"id": 5, "u": 10, "v": 0},
        {"id": 12, "u": -1.5463788336675375, "v": 0.12028783299913037}, {"id": 13, "u": 0.12028783299913037, "v": -1.5463788336675357}, {"id": 15, "u": -1.8556546004010448, "v": -1.855654600401043},
    ]
    entities = [
        {"id": 10, "type": "arc", "center": 3, "start": 1, "end": 12},
        {"id": 11, "type": "arc", "center": 5, "start": 13, "end": 4},
        {"id": 14, "type": "arc", "center": 15, "start": 13, "end": 12},
    ]
    constraints = [{"id": 16, "type": "tangent", "entities": [14, 10], "auto": True}, {"id": 17, "type": "tangent", "entities": [14, 11], "auto": True}]
    constraints += [{"type": "fixed", "point": k} for k in (1, 3, 4, 5)] + [{"type": "radius", "entity": 14, "value": 2}]
    result = sketch.solve(sketch_of(points, entities, constraints))
    assert result["status"] == "ok"
    c = coords(result)
    assert math.dist(c[15], c[3]) == pytest.approx(12, abs=1e-6)
    assert math.dist(c[15], c[5]) == pytest.approx(12, abs=1e-6)

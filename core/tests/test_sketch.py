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
    # seen from the side the round holes in the top face are tilted: they are skipped and counted, their ends still project
    side = session.handle({"type": "sketch_project", "plane": STANDARD_PLANES["XZ"]})
    assert side["skipped"]["tilted_circles"] > 0
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

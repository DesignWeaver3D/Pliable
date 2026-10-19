import math

import pytest

from pliable.demos import load_demo
from pliable.holes import find_hole
from pliable.ops import OperationError
from pliable.topology import Topology
from pliable.tools import Selection, get_tool
from test_features import faces_where, run, volume


@pytest.fixture
def block():
    return Topology(load_demo("block"))  # 40 x 30 x 20, top at z = 10


def top_face(topology):
    return max(range(topology.face_count), key=lambda i: __import__("pliable.measure", fromlist=["x"]).measure_face(topology, i, topology.face(i))["anchor"][2] if _flat(topology, i) else -1e9)


def _flat(topology, i):
    from pliable.ops import planar_normal

    return planar_normal(topology.face(i)) is not None


def drilled(block, tool, **params):
    return Topology(run(tool, block, faces=[top_face(block)], **params).shape)


def only_hole(topology):
    holes = {}
    for i in range(topology.face_count):
        try:
            h = find_hole(topology, face_id=i)
        except OperationError:
            continue
        holes[tuple(h.faces)] = h
    assert len(holes) == 1
    return next(iter(holes.values()))


def test_bracket_through_holes():
    bracket = Topology(load_demo("bracket"))
    wall = faces_where(bracket, "Cylinder", Radius=4)[0]
    hole = find_hole(bracket, face_id=wall)
    assert hole.through and hole.bottom == "through" and hole.kind == "plain"
    assert hole.diameter == pytest.approx(8) and hole.depth == pytest.approx(10)
    assert hole.direction.Z() == pytest.approx(-1)  # runs down from the top face
    assert hole.entry.Z() == pytest.approx(5)
    assert len(hole.rim_edges) == 1  # the circle at the opening


def test_blind_hole_from_rim_edge(block):
    part = drilled(block, "add_hole", diameter=6, depth=8)
    hole = only_hole(part)
    assert not hole.through and hole.bottom == "flat"
    assert hole.depth == pytest.approx(8) and hole.diameter == pytest.approx(6)
    assert hole.pass_length == pytest.approx(20)
    assert len(hole.rim_edges) == 1
    from_edge = find_hole(part, edge_id=hole.rim_edges[0])
    assert from_edge.faces == hole.faces
    bottom = [i for i in hole.faces if _flat(part, i)]
    assert find_hole(part, face_id=bottom[0]).faces == hole.faces


def test_counterbore_and_countersink(block):
    cb = only_hole(drilled(block, "add_counterbore", diameter=6, depth=0, bore_diameter=12, bore_depth=4))
    assert cb.kind == "counterbore" and cb.through
    assert cb.stages == [{"type": "counterbore", "diameter": pytest.approx(12), "depth": pytest.approx(4)}]
    assert cb.diameter == pytest.approx(6) and cb.depth == pytest.approx(20)
    cs = only_hole(drilled(block, "add_countersink", diameter=6, depth=10, sink_diameter=12, sink_angle=90))
    assert cs.kind == "countersink" and not cs.through
    (stage,) = cs.stages
    assert stage["diameter"] == pytest.approx(12) and stage["angle"] == pytest.approx(90) and stage["depth"] == pytest.approx(3)
    assert cs.depth == pytest.approx(10)


def test_not_a_hole(block):
    with pytest.raises(OperationError, match="pocket or slot"):
        find_hole(block, face_id=top_face(block))
    # A boss and the top of a round post are not holes either.
    post = Topology(run("add_cylinder", block, diameter=10, height=10, x=0, y=0, z=10).shape)
    for i in range(post.face_count):
        with pytest.raises(OperationError):
            find_hole(post, face_id=i)


def test_rectangular_and_slot_cuts_are_not_holes():
    from build123d import Box, Cylinder, Pos, SlotOverall

    plate = Box(40, 30, 10)
    square = Topology((plate - Pos(0, 0, 0) * Box(10, 8, 20)).wrapped)
    slotted = Topology((plate - (Pos(0, 0, 0) * (Box(14, 6, 20) + Pos(7, 0, 0) * Cylinder(3, 20) + Pos(-7, 0, 0) * Cylinder(3, 20)))).wrapped)
    for part in (square, slotted):
        for i in range(part.face_count):
            with pytest.raises(OperationError, match="pocket or slot"):
                find_hole(part, face_id=i)


def test_measure_reports_the_hole(block):
    from pliable.measure import measure
    from pliable.tools import Selection

    part = drilled(block, "add_counterbore", diameter=6, depth=0, bore_diameter=12, bore_depth=4)
    wall = faces_where(part, "Cylinder", Radius=3)[0]
    item = measure(part, Selection(faces=[wall]))["items"][0]
    assert item["hole"]["kind"] == "counterbore" and item["hole"]["through"]
    rows = {r["label"]: r["value"] for r in item["rows"]}
    assert rows["Hole depth"] == "through" and rows["Hole diameter"] == pytest.approx(6)
    rim = item["hole"]["rimEdges"][0]
    assert measure(part, Selection(edges=[rim]))["items"][0]["hole"]["faces"] == item["hole"]["faces"]
    top = measure(part, Selection(faces=[top_face(part)]))["items"][0]
    assert "hole" not in top


def hole_wall(topology):
    return only_hole(topology).faces[0]


def test_edit_hole_diameter_depth_and_move(block):
    part = drilled(block, "add_hole", diameter=6, depth=8)
    wall = hole_wall(part)
    base = volume(part.shape)
    wider = run("edit_hole", part, faces=[wall], diameter=10)
    assert volume(wider.shape) == pytest.approx(base - math.pi * (25 - 9) * 8, rel=1e-3)
    deeper = Topology(run("edit_hole", part, faces=[wall], depth=12).shape)
    assert volume(deeper.shape) == pytest.approx(base - math.pi * 9 * 4, rel=1e-3)
    assert only_hole(deeper).depth == pytest.approx(12) and not only_hole(deeper).through
    through = Topology(run("edit_hole", part, faces=[wall], depth=50).shape)  # past the body: through
    assert only_hole(through).through and only_hole(through).diameter == pytest.approx(6)
    shallow = Topology(run("edit_hole", through, faces=[hole_wall(through)], depth=5).shape)
    assert not only_hole(shallow).through and only_hole(shallow).depth == pytest.approx(5)
    moved = Topology(run("edit_hole", part, edges=only_hole(part).rim_edges, dx=7, dy=-3).shape)
    h = only_hole(moved)
    assert h.entry.X() == pytest.approx(7) and h.entry.Y() == pytest.approx(-3) and h.depth == pytest.approx(8)
    assert volume(moved.shape) == pytest.approx(base, rel=1e-4)


def test_edit_counterbore_keeps_its_steps(block):
    part = drilled(block, "add_counterbore", diameter=6, depth=0, bore_diameter=12, bore_depth=4)
    wall = faces_where(part, "Cylinder", Radius=3)[0]
    edited = Topology(run("edit_hole", part, faces=[wall], diameter=8).shape)
    hole = only_hole(edited)
    assert hole.kind == "counterbore" and hole.diameter == pytest.approx(8) and hole.through
    with pytest.raises(OperationError, match="narrower"):
        run("edit_hole", part, faces=[wall], diameter=13)
    with pytest.raises(OperationError, match="past the counterbore"):
        run("edit_hole", part, faces=[wall], depth=3)


def test_edit_hole_handles(block):
    part = drilled(block, "add_hole", diameter=6, depth=8)
    wall = hole_wall(part)
    tool = get_tool("edit_hole")
    handles = {h["param"]: h for h in tool.handle_list(part, Selection(faces=[wall]), {})}
    assert set(handles) == {"depth", "diameter", "dx", "dy"}
    depth = handles["depth"]
    assert depth["value"] == pytest.approx(8) and depth["max"] == pytest.approx(20) and depth["axisFrom"][2] == pytest.approx(10)
    assert depth["anchor"][2] == pytest.approx(2) and depth["direction"] == pytest.approx([0, 0, -1])
    assert handles["diameter"]["value"] == pytest.approx(6) and handles["diameter"]["scale"] == 2
    moved = {h["param"]: h for h in tool.handle_list(part, Selection(faces=[wall]), {"dx": 5, "depth": 12})}
    assert moved["depth"]["anchor"][0] == pytest.approx(5) and moved["depth"]["value"] == pytest.approx(12)
    # not a hole: no tool, no handles
    assert not tool.available(block, Selection(faces=[top_face(block)]))
    assert tool.available(part, Selection(faces=[wall]))


def test_convert_to_countersink(block):
    part = drilled(block, "add_hole", diameter=6, depth=0)
    wall = hole_wall(part)
    result = Topology(run("convert_to_countersink", part, faces=[wall], sink_diameter=12, sink_angle=90).shape)
    hole = only_hole(result)
    assert hole.kind == "countersink" and hole.through
    (stage,) = hole.stages
    assert stage["diameter"] == pytest.approx(12) and stage["angle"] == pytest.approx(90)
    expected = math.pi * 3 / 3 * (6**2 + 6 * 3 + 3**2)  # cone frustum, height 3, radii 6 and 3
    assert volume(part.shape) - volume(result.shape) == pytest.approx(expected - math.pi * 9 * 3, rel=1e-3)
    with pytest.raises(OperationError, match="wider than the hole"):
        run("convert_to_countersink", part, faces=[wall], sink_diameter=5)
    # converting again replaces the cone
    again = Topology(run("convert_to_countersink", result, faces=[hole.faces[0]], sink_diameter=10, sink_angle=82).shape)
    assert only_hole(again).stages[0]["diameter"] == pytest.approx(10)


def test_mesh_centres_carry_the_axis_length():
    from pliable.tessellate import tessellate

    bracket = Topology(load_demo("bracket"))
    mesh = tessellate(bracket)
    lengths = sorted(round(c["length"], 6) for c in mesh.centres)
    assert lengths == [10.0] * 5


def test_hole_tools_explain_when_given_a_pocket(block):
    from build123d import Box

    plate = Topology((Box(40, 30, 10) - Box(10, 8, 20)).wrapped)
    wall = next(i for i in range(plate.face_count) if i != top_face(plate) and _flat(plate, i))
    for tool in ("resize_hole", "edit_hole", "convert_to_countersink", "fill_hole"):
        with pytest.raises(OperationError, match="pocket or slot"):
            run(tool, plate, faces=[wall])

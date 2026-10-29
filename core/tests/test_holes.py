import math

import pytest

from pliable.demos import load_demo
from pliable.holes import find_hole
from pliable.ops import OperationError
from pliable.topology import Topology
from pliable.tools import Selection, get_tool
from test_features import faces_where, run, top_of, volume


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
    assert set(handles) == {"depth", "start", "diameter", "dx", "dy"}
    depth = handles["depth"]
    assert depth["value"] == pytest.approx(8) and depth["max"] == pytest.approx(20) and depth["axisFrom"][2] == pytest.approx(10)
    assert depth["anchor"][2] == pytest.approx(2) and depth["direction"] == pytest.approx([0, 0, -1])
    assert handles["diameter"]["value"] == pytest.approx(6) and handles["diameter"]["scale"] == 2
    rim = [h for h in tool.handle_list(part, Selection(faces=[wall]), {}) if h["param"] == "diameter"]
    assert sorted(h["symbol"] for h in rim) == ["R", "Ø", "Ø"] and all(h["value"] == pytest.approx(6) for h in rim)
    moved = {h["param"]: h for h in tool.handle_list(part, Selection(faces=[wall]), {"dx": 5, "depth": 12})}
    assert moved["depth"]["anchor"][0] == pytest.approx(5) and moved["depth"]["value"] == pytest.approx(12)
    # not a hole: no tool, no handles
    assert not tool.available(block, Selection(faces=[top_face(block)]))
    assert tool.available(part, Selection(faces=[wall]))


def test_edit_hole_start_leaves_a_skin(block):
    part = drilled(block, "add_hole", diameter=6, depth=8)
    wall = hole_wall(part)
    tool = get_tool("edit_hole")
    start = {h["param"]: h for h in tool.handle_list(part, Selection(faces=[wall]), {})}["start"]
    assert start["value"] == pytest.approx(0) and start["anchor"][2] == pytest.approx(10) and start["max"] < 8
    result = run("edit_hole", part, faces=[wall], start=3)
    # the bore now spans 3..8 (5 long) instead of 0..8
    assert volume(part.shape) - volume(result.shape) == pytest.approx(-math.pi * 9 * 3)
    with pytest.raises(OperationError):
        run("edit_hole", part, faces=[wall], start=9)
    shifted = {h["param"]: h for h in tool.handle_list(part, Selection(faces=[wall]), {"start": 3})}
    assert shifted["start"]["anchor"][2] == pytest.approx(7) and shifted["depth"]["min"] > 3


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


def test_counterbore_and_countersink_at_either_or_both_ends(block):
    part = drilled(block, "add_hole", diameter=6, depth=0)  # through the 20 thick block
    wall = hole_wall(part)
    base = volume(part.shape)
    near = Topology(run("convert_to_counterbore", part, faces=[wall], bore_diameter=12, bore_depth=5).shape)
    hole = only_hole(near)
    assert hole.kind == "counterbore" and hole.through and not hole.end_stages
    assert hole.stages[0]["diameter"] == pytest.approx(12) and hole.stages[0]["depth"] == pytest.approx(5)
    assert base - volume(near.shape) == pytest.approx(math.pi * (36 - 9) * 5, rel=1e-6)
    # the other end: a countersink there, on the same hole
    both = Topology(run("convert_to_countersink", near, faces=[hole.faces[0]], sink_diameter=10, sink_angle=90, end=1).shape)
    hole = only_hole(both)
    assert hole.through and hole.diameter == pytest.approx(6) and hole.depth == pytest.approx(20)
    assert [s["type"] for s in hole.stages] == ["counterbore"] and [s["type"] for s in hole.end_stages] == ["countersink"]
    assert hole.end_stages[0]["depth"] == pytest.approx(2) and hole.end_stages[0]["diameter"] == pytest.approx(10)
    cone = math.pi * 2 / 3 * (25 + 15 + 9) - math.pi * 9 * 2  # frustum of height 2 (radii 5 and 3) minus the bore it replaces
    assert volume(near.shape) - volume(both.shape) == pytest.approx(cone, rel=1e-6)
    # a cone is replaced by another cone, not by a counterbore; a counterbore can still go at the far end of the plain side
    with pytest.raises(OperationError, match="countersink"):
        run("convert_to_counterbore", both, faces=[hole.faces[0]], bore_diameter=9, bore_depth=3, end=1)
    twin = Topology(run("convert_to_counterbore", near, faces=[only_hole(near).faces[0]], bore_diameter=9, bore_depth=3, end=1).shape)
    assert [s["type"] for s in only_hole(twin).end_stages] == ["counterbore"] and only_hole(twin).end_stages[0]["depth"] == pytest.approx(3)
    with pytest.raises(OperationError, match="meet|deeper"):
        run("convert_to_counterbore", near, faces=[only_hole(near).faces[0]], bore_diameter=9, bore_depth=16, end=1)
    with pytest.raises(OperationError, match="far end"):
        blind = drilled(block, "add_hole", diameter=6, depth=8)
        run("convert_to_countersink", blind, faces=[hole_wall(blind)], end=1)


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


def test_preview_dimensions_follow_the_moved_hole():
    from pliable.protocol import decode_binary
    from pliable.server import Session

    session = Session(None)
    session.handle({"type": "open_demo", "name": "bracket"})
    wall = faces_where(session.document.current, "Cylinder", Radius=4)[0]

    def dims(dx):
        request = {"type": "tool_preview", "tool": "edit_hole", "selection": {"faces": [wall]}, "params": {"dx": dx}}
        header, _ = decode_binary(session.handle(request))
        return header["dimensions"]

    base, moved = dims(0), dims(2)
    assert base and len(base) == len(moved)
    assert base != moved
    assert [d["text"] for d in base] != [d["text"] for d in moved] or base[0]["points"] != moved[0]["points"]
    # a commit carries none: the page asks for the measurement of the committed model
    header, _ = decode_binary(session.handle({"type": "tool_commit", "tool": "edit_hole", "selection": {"faces": [wall]}, "params": {"dx": 2}}))
    assert "dimensions" not in header


def test_circular_and_elliptical_edges_report_their_centres():
    from build123d import Box, Cylinder, Pos, Rot

    from pliable.tessellate import tessellate

    plate = Box(40, 40, 10)
    straight = plate - Pos(10, 0, 0) * Cylinder(3, 20)
    slanted = straight - Pos(-10, 0, 0) * Rot(30, 0, 0) * Cylinder(2, 30)
    mesh = tessellate(Topology(slanted.wrapped))
    centres = [e["centre"] for e in mesh.edges if e["centre"] is not None]
    assert len(centres) == 4  # two mouths of each hole
    flat = [c for c in centres if abs(c[0] - 10) < 1e-6]
    assert len(flat) == 2 and sorted(round(c[2], 6) for c in flat) == [-5, 5]
    angled = [c for c in centres if abs(c[0] + 10) < 1e-6]  # the elliptical mouths: center where the axis meets the face
    assert sorted(round(c[2], 6) for c in angled) == [-5, 5] and all(abs(c[1]) < 6 for c in angled)
    assert all(e["centre"] is None for e in mesh.edges if e["count"] == 2)  # straight edges have none


def test_edit_hole_step_depth_grips(block):
    part = drilled(block, "add_counterbore", diameter=6, depth=0, bore_diameter=12, bore_depth=4)
    wall = faces_where(part, "Cylinder", Radius=3)[0]
    tool = get_tool("edit_hole")
    handles = {h["param"]: h for h in tool.handle_list(part, Selection(faces=[wall]), {})}
    step = handles["step_depth"]
    assert step["value"] == pytest.approx(4) and step["anchor"][2] == pytest.approx(6) and step["direction"] == pytest.approx([0, 0, -1])
    deeper = Topology(run("edit_hole", part, faces=[wall], step_depth=7).shape)
    hole = only_hole(deeper)
    assert hole.stages[0]["type"] == "counterbore" and hole.stages[0]["depth"] == pytest.approx(7) and hole.through
    assert volume(deeper.shape) < volume(part.shape)
    with pytest.raises(OperationError, match="shallower"):
        run("edit_hole", part, faces=[wall], step_depth=30)
    plain = drilled(block, "add_hole", diameter=6, depth=0)
    with pytest.raises(OperationError, match="no counterbore"):
        run("edit_hole", plain, faces=[hole_wall(plain)], step_depth=2)


def test_edit_countersink_step_depth_widens_the_mouth(block):
    part = drilled(block, "add_countersink", diameter=6, depth=0, sink_diameter=12, sink_angle=90)
    wall = faces_where(part, "Cylinder", Radius=3)[0]
    deeper = Topology(run("edit_hole", part, faces=[wall], step_depth=5).shape)
    hole = only_hole(deeper)
    assert hole.stages[0]["type"] == "countersink" and hole.stages[0]["diameter"] == pytest.approx(16) and hole.stages[0]["angle"] == pytest.approx(90)


def test_countersink_and_counterbore_size_by_offset_matches_the_diameter(block):
    part = drilled(block, "add_hole", diameter=6, depth=0)
    wall = hole_wall(part)
    by_diameter = run("convert_to_countersink", part, faces=[wall], sink_diameter=12, sink_angle=90)
    by_offset = run("convert_to_countersink", part, faces=[wall], sink_by=1, sink_offset=3, sink_angle=90)  # 6 + 2 * 3
    assert volume(by_offset.shape) == pytest.approx(volume(by_diameter.shape), rel=1e-9)
    cb_diameter = run("convert_to_counterbore", part, faces=[wall], bore_diameter=11, bore_depth=4)
    cb_offset = run("convert_to_counterbore", part, faces=[wall], bore_by=1, bore_offset=2.5, bore_depth=4)
    assert volume(cb_offset.shape) == pytest.approx(volume(cb_diameter.shape), rel=1e-9)
    top = top_of(block)
    assert volume(run("add_countersink", block, faces=[top], diameter=6, depth=0, sink_by=1, sink_offset=3).shape) == pytest.approx(volume(run("add_countersink", block, faces=[top], diameter=6, depth=0, sink_diameter=12).shape), rel=1e-9)
    assert volume(run("add_counterbore", block, faces=[top], diameter=6, depth=0, bore_by=1, bore_offset=3, bore_depth=4).shape) == pytest.approx(volume(run("add_counterbore", block, faces=[top], diameter=6, depth=0, bore_diameter=12, bore_depth=4).shape), rel=1e-9)
    with pytest.raises(OperationError, match="wider than the hole"):
        run("convert_to_countersink", part, faces=[wall], sink_by=1, sink_offset=0)


def test_countersink_angle_gizmo_turns_the_cone_about_its_mouth(block):
    part = drilled(block, "add_hole", diameter=6, depth=0)
    wall = hole_wall(part)
    tool = get_tool("convert_to_countersink")
    values = tool.bind({"sink_diameter": 12, "sink_angle": 90})
    handles = {h.label: h for h in tool.handles(part, Selection(faces=[wall]), values)}
    angle = handles["Countersink angle"]
    assert angle.param == "sink_angle" and angle.arc and (angle.min, angle.max) == (10.0, 170.0) and angle.unit == "°"
    along = sum(a * b for a, b in zip(angle.direction, angle.direction))
    assert along == pytest.approx(1.0)
    offset = tool.bind({"sink_by": 1, "sink_offset": 3, "sink_angle": 90})
    labels = [h.label for h in tool.handles(part, Selection(faces=[wall]), offset)]
    assert "Countersink offset" in labels and "Countersink angle" in labels and not any(l.startswith("Countersink radius") for l in labels)

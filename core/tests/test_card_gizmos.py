"""Handles (gizmos) of the card parameters of resize, shell, offset, mirror, revolve, chamfer, array and hole tools."""

import math

import pytest

from pliable.demos import load_demo
from pliable.measure import measure
from pliable.ops import fillet_chamfer
from pliable.tools import Selection, get_tool
from pliable.topology import Topology


def block():
    return Topology(load_demo("block"))  # 40 x 30 x 20


def dist(a, b):
    return math.dist(a, b)


def face_titled(topology, title):
    return [i for i in range(topology.face_count) if measure(topology, Selection(faces=[i]))["items"][0]["title"] == title]


def rounded(distance, chamfer=False):
    """The block with its top edge at x = -20 rounded (or bevelled) by `distance`."""
    base = block()
    shape = fillet_chamfer(base.shape, [base.edge(1)], -distance if chamfer else distance).shape
    return Topology(shape)


def surface_middle(topology, face):
    from OCP.BRepAdaptor import BRepAdaptor_Surface
    from OCP.BRepTools import BRepTools

    u0, u1, v0, v1 = BRepTools.UVBounds_s(topology.face(face))
    p = BRepAdaptor_Surface(topology.face(face)).Value((u0 + u1) / 2, (v0 + v1) / 2)
    return (p.X(), p.Y(), p.Z())


def test_resize_fillet_grip_sits_where_the_resized_fillet_surface_is():
    topology = rounded(3)
    (face,) = face_titled(topology, "Fillet")
    tool = get_tool("resize_fillet")
    selection = Selection(faces=[face])
    for radius in (3, 5):
        handles = tool.handles(topology, selection, {"radius": radius, "end_radius": 0})
        assert [h.param for h in handles] == ["radius"]
        result = tool.execute(topology, selection, {"radius": radius, "end_radius": 0}, preview=False)
        after = Topology(result.shape)
        (new,) = face_titled(after, "Fillet")
        assert dist(handles[0].anchor, surface_middle(after, new)) < 1e-4


def hole_faces(topology):
    from pliable.ops import OperationError
    from pliable.shared.hole_groups import Hole

    out = []
    for i in range(topology.face_count):
        try:
            Hole(topology.face(i))
            out.append(i)
        except OperationError:
            pass
    return out


def test_resize_hole_has_radius_and_diameter_grips_that_show_the_current_size_at_zero():
    topology = Topology(load_demo("bracket"))
    from pliable.shared.hole_groups import Hole

    face = hole_faces(topology)[0]
    selection = Selection(faces=[face])
    tool = get_tool("resize_hole")
    size = 2 * Hole(topology.face(face)).radius
    handles = tool.handles(topology, selection, {"diameter": 0})
    assert [h.param for h in handles] == ["diameter"] * 3
    assert all(h.shown == pytest.approx(size) for h in handles)
    wider = tool.handles(topology, selection, {"diameter": size + 4})
    assert dist(wider[0].anchor, handles[0].anchor) == pytest.approx(2)  # the radius grip moves half the diameter change


def test_shell_grip_starts_on_the_opened_face_rim_and_follows_the_thickness():
    topology = block()
    top = max(range(topology.face_count), key=lambda i: measure(topology, Selection(faces=[i]))["items"][0]["anchor"][2])
    tool = get_tool("shell")
    selection = Selection(faces=[top])
    one = tool.handles(topology, selection, {"thickness": 1})[0]
    four = tool.handles(topology, selection, {"thickness": 4})[0]
    assert one.param == "thickness" and dist(one.anchor, four.anchor) == pytest.approx(3)
    assert one.anchor[2] == pytest.approx(10)  # on the opened face, its wall seen from the rim
    assert abs(one.anchor[0]) <= 20 and abs(one.anchor[1]) <= 15  # inside the face outline
    result = tool.execute(topology, selection, {"thickness": 4}, preview=False)
    assert result.shape is not None


def test_offset_body_grip_sits_on_the_grown_side():
    topology = block()
    tool = get_tool("offset_body")
    for d in (0, 3):
        (handle,) = tool.handles(topology, Selection(), {"distance": d})
        assert handle.anchor[0] == pytest.approx(20 + d) and handle.direction == (1.0, 0.0, 0.0)
    grown = tool.execute(topology, Selection(), {"distance": 3}, preview=False)
    from test_gizmo_tools import bounds

    assert bounds(grown.shape)[1][0] == pytest.approx(23, abs=1e-3)


def test_mirror_grip_follows_the_offset_along_the_plane_normal():
    topology = block()
    tool = get_tool("mirror")
    base = {"plane": 3, "px": 0, "py": 0, "pz": 0, "nx": 0, "ny": 0, "nz": 1}  # the YZ origin plane
    near = tool.handles(topology, Selection(), {**base, "offset": 0})[0]
    far = tool.handles(topology, Selection(), {**base, "offset": 30})[0]
    assert near.param == "offset" and near.direction == pytest.approx((1, 0, 0))
    assert far.anchor[0] - near.anchor[0] == pytest.approx(30) and near.anchor[0] == pytest.approx(0)
    assert tool.handles(topology, Selection(), {**base, "plane": 0, "offset": 0}) == []  # no face selected yet


def test_chamfer_distance_angle_grips_follow_distance_and_angle_and_match_the_bevel():
    topology = block()
    top = max(range(topology.face_count), key=lambda i: measure(topology, Selection(faces=[i]))["items"][0]["anchor"][2])
    tool = get_tool("chamfer_distance_angle")
    selection = Selection(faces=[top], edges=[1])  # edge 1: the top edge at x = -20
    values = {"distance": 4, "angle": 30}
    distance, angle = tool.handles(topology, selection, values)
    assert (distance.param, angle.param) == ("distance", "angle")
    assert distance.anchor == pytest.approx((-16, 0, 10))  # 4 in from the edge on the top face
    assert angle.ring[:3] == pytest.approx(distance.anchor) and angle.arc
    steep = tool.handles(topology, selection, {"distance": 4, "angle": 60})[1]
    centre = angle.ring[:3]
    assert dist(angle.anchor, centre) == pytest.approx(angle.ring[3]) and dist(steep.anchor, centre) == pytest.approx(angle.ring[3])
    assert angle.anchor[2] < 10 and steep.anchor[2] < angle.anchor[2]  # a steeper bevel goes lower
    result = tool.execute(topology, selection, values, preview=False)
    assert result.shape is not None


def test_revolve_face_pie_grip_rides_the_ring_of_the_face_middle():
    topology = block()
    top = max(range(topology.face_count), key=lambda i: measure(topology, Selection(faces=[i]))["items"][0]["anchor"][2])
    selection = Selection(faces=[top], edges=[5])  # the top edge at x = 20 runs along y: the axis, 20 from the face middle
    tool = get_tool("revolve_face")
    quarter = tool.handles(topology, selection, {"angle": 90, "mode": 0})[0]
    half = tool.handles(topology, selection, {"angle": 180, "mode": 0})[0]
    assert quarter.param == "angle" and quarter.pie and (quarter.min, quarter.max) == (-360.0, 360.0)
    assert quarter.ring[3] == pytest.approx(20) and quarter.axis in ((0.0, 1.0, 0.0), (0.0, -1.0, 0.0))
    assert dist(quarter.anchor, half.anchor) == pytest.approx(2 * 20 * math.sin(math.radians(45)))  # a quarter turn further round the ring


def test_revolve_face_pie_grip_follows_the_axis_chosen_in_the_form():
    topology = block()
    top = max(range(topology.face_count), key=lambda i: measure(topology, Selection(faces=[i]))["items"][0]["anchor"][2])
    tool = get_tool("revolve_face")
    from_form = tool.handles(topology, Selection(faces=[top]), {"angle": 90, "mode": 0, "axis": 1, "axis_edge": -1})  # the Y axis from the form's buttons
    from_selection = tool.handles(topology, Selection(faces=[top], axes=[1]), {"angle": 90, "mode": 0})
    assert len(from_form) == 1 and from_form[0].pie and from_form[0].axis in ((0.0, 1.0, 0.0), (0.0, -1.0, 0.0))
    assert from_form[0].anchor == pytest.approx(from_selection[0].anchor)
    assert tool.handles(topology, Selection(faces=[top]), {"angle": 90, "mode": 0, "axis": 3, "axis_edge": -1}) == []  # no axis picked yet


def test_path_array_count_badge_sits_at_the_start_of_the_path():
    topology = block()
    tool = get_tool("path_array")
    selection = Selection(edges=[8])  # the bottom edge along x
    (badge,) = tool.handles(topology, selection, {"count": 4})
    assert badge.param == "count" and badge.badge and badge.min == 2
    assert badge.anchor == pytest.approx((-20, -15, -10)) or badge.anchor == pytest.approx((20, -15, -10))
    assert tool.handles(topology, Selection(), {"count": 4}) == []
    assert tool.execute(topology, selection, {"count": 3}, preview=False).shape is not None


def top_of(topology):
    return max(range(topology.face_count), key=lambda i: measure(topology, Selection(faces=[i]))["items"][0]["anchor"][2])


NEW_HOLE = {"diameter": 6, "depth": 0, "offset_u": 0, "offset_v": 0}


@pytest.mark.parametrize("tool_id, extra, params", [
    ("add_hole", {}, ["diameter", "diameter", "diameter", "depth", "offset_u", "offset_v"]),
    ("add_counterbore", {"bore_by": 0, "bore_diameter": 11, "bore_offset": 2.5, "bore_depth": 4}, ["diameter"] * 3 + ["depth", "offset_u", "offset_v"] + ["bore_diameter"] * 3 + ["bore_depth"]),
    ("add_countersink", {"sink_by": 0, "sink_diameter": 12, "sink_offset": 3, "sink_angle": 90}, ["diameter"] * 3 + ["depth", "offset_u", "offset_v"] + ["sink_diameter"] * 3 + ["sink_angle"]),
    ("add_countersink", {"sink_by": 1, "sink_diameter": 12, "sink_offset": 3, "sink_angle": 90}, ["diameter"] * 3 + ["depth", "offset_u", "offset_v", "sink_offset", "sink_angle"]),
])
def test_new_hole_cards_have_a_grip_for_every_number(tool_id, extra, params):
    topology = block()
    selection = Selection(faces=[top_of(topology)])
    tool = get_tool(tool_id)
    handles = tool.handles(topology, selection, {**NEW_HOLE, **extra})
    assert [h.param for h in handles] == params


def test_new_hole_grips_sit_where_the_cut_goes_and_follow_the_values():
    topology = block()
    selection = Selection(faces=[top_of(topology)])
    tool = get_tool("add_hole")
    depth = next(h for h in tool.handles(topology, selection, {**NEW_HOLE, "offset_u": 5, "depth": 4}) if h.param == "depth")
    assert depth.anchor[2] == pytest.approx(6) and depth.shown == 4  # 4 down from the top face
    through = next(h for h in tool.handles(topology, selection, NEW_HOLE) if h.param == "depth")
    assert through.anchor[2] == pytest.approx(-10) and through.shown == pytest.approx(20)  # depth 0: the far side
    radius = next(h for h in tool.handles(topology, selection, {**NEW_HOLE, "diameter": 10}) if h.symbol == "R")
    centre = radius.anchor
    assert dist(centre, next(h for h in tool.handles(topology, selection, NEW_HOLE) if h.symbol == "R").anchor) == pytest.approx(2)
    moved = next(h for h in tool.handles(topology, selection, {**NEW_HOLE, "offset_u": 5}) if h.param == "offset_u")
    still = next(h for h in tool.handles(topology, selection, NEW_HOLE) if h.param == "offset_u")
    assert dist(moved.anchor, still.anchor) == pytest.approx(5)


def test_add_boss_has_grips_for_diameter_height_and_place():
    topology = block()
    selection = Selection(faces=[top_of(topology)])
    tool = get_tool("add_boss")
    values = {"diameter": 10, "height": 5, "offset_u": 0, "offset_v": 0}
    handles = tool.handles(topology, selection, values)
    assert [h.param for h in handles] == ["diameter"] * 3 + ["height", "offset_u", "offset_v"]
    height = handles[3]
    assert height.anchor[2] == pytest.approx(15) and height.direction == pytest.approx((0, 0, 1))
    assert tool.handles(topology, selection, {**values, "height": 8})[3].anchor[2] == pytest.approx(18)


def test_new_countersink_angle_grip_sits_at_the_foot_of_the_cone():
    topology = block()
    selection = Selection(faces=[top_of(topology)])
    values = {**NEW_HOLE, "sink_by": 0, "sink_diameter": 12, "sink_offset": 3, "sink_angle": 90}
    grip = next(h for h in get_tool("add_countersink").handles(topology, selection, values) if h.param == "sink_angle")
    # hole radius 3, mouth radius 6, 90 degrees: the cone meets the bore 3 below the face, 3 in from the mouth
    assert grip.anchor[2] == pytest.approx(7, abs=1e-6)
    assert abs(math.hypot(grip.anchor[0], grip.anchor[1]) - 3) < 1e-6


def test_pattern_hole_has_a_spacing_grip_and_a_count_badge():
    topology = Topology(load_demo("bracket"))
    face = hole_faces(topology)[0]
    selection = Selection(faces=[face])
    tool = get_tool("pattern_hole")
    near = tool.handles(topology, selection, {"count": 3, "dx": 10, "dy": 0, "dz": 0})
    far = tool.handles(topology, selection, {"count": 3, "dx": 25, "dy": 0, "dz": 0})
    assert [h.param for h in near] == ["dx", "count"] and near[1].badge
    assert dist(near[0].anchor, far[0].anchor) == pytest.approx(15)  # the grip sits on the second copy
    assert dist(near[1].anchor, near[0].anchor) == pytest.approx(10)  # and the badge on the source


def test_circular_pattern_hole_has_an_angle_pie_and_a_count_badge():
    topology = Topology(load_demo("bracket"))
    face = hole_faces(topology)[0]
    selection = Selection(faces=[face])
    tool = get_tool("pattern_hole_circular")
    values = {"count": 6, "angle": 360, "px": 1000, "py": 0, "pz": 0, "ax": 0, "ay": 0, "az": 1}
    angle, count = tool.handles(topology, selection, values)
    assert (angle.param, count.param) == ("angle", "count") and angle.pie and count.badge
    assert angle.ring[3] == pytest.approx(dist(count.anchor[:2], (1000, 0)))  # the ring runs through the source hole
    assert tool.handles(topology, selection, {**values, "ax": 0, "az": 0}) == []


def test_stretch_has_three_move_arrows_at_the_end_face_that_follow_the_move():
    topology = block()
    top = top_of(topology)
    tool = get_tool("stretch")
    rest = tool.handles(topology, Selection(faces=[top]), {"dx": 0, "dy": 0, "dz": 0, "mode": 0})
    moved = tool.handles(topology, Selection(faces=[top]), {"dx": 0, "dy": 0, "dz": 6, "mode": 0})
    assert [h.param for h in rest] == ["dx", "dy", "dz"] and all(h.kind == "move" for h in rest)
    assert rest[0].anchor == pytest.approx((0, 0, 10)) and moved[2].anchor[2] - rest[2].anchor[2] == pytest.approx(6)
    result = tool.execute(topology, Selection(faces=[top]), {"dx": 0, "dy": 0, "dz": 6, "mode": 0}, preview=False)
    from test_gizmo_tools import bounds

    assert bounds(result.shape)[1][2] == pytest.approx(16, abs=1e-3)


def test_helical_sweep_pitch_dimension_and_turns_number():
    topology = block()
    top = top_of(topology)
    tool = get_tool("helical_sweep")
    pitch, turns = tool.handles(topology, Selection(faces=[top], axes=[1]), {"mode": 0, "pitch": 12, "turns": 3, "hand": 0, "axis": 3, "axis_edge": -1})
    assert pitch.param == "pitch" and pitch.arrowhead and pitch.axis_from is not None and pitch.extension is not None
    assert dist(pitch.anchor, pitch.axis_from) == pytest.approx(12)  # the dimension is one pitch long
    assert pitch.axis_from[2] > 10  # outside the profile (the top face, z = 10), on the side away from the Y axis through the origin
    assert pitch.extension == pytest.approx((0, 0, -(pitch.axis_from[2] - 10)))  # the extension lines run back in to the face's middle line
    assert turns.param == "turns" and turns.badge
    assert tool.handles(topology, Selection(faces=[top]), {"mode": 0, "pitch": 12, "turns": 3, "hand": 0, "axis": 3, "axis_edge": -1}) == []

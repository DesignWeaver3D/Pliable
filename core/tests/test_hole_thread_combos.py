"""Threads on holes: how far the groove runs, and a thread together with a counterbore or countersink."""

import pytest
from OCP.BRepAlgoAPI import BRepAlgoAPI_Common
from OCP.BRepPrimAPI import BRepPrimAPI_MakeBox
from OCP.gp import gp_Pnt

from pliable.demos import load_demo
from pliable.hole_bore import bore_wall
from pliable.hole_selection import classify
from pliable.topology import Topology
from pliable.tools import Selection, get_tool
from test_features import run, volume
from test_holes import top_face

THREAD = dict(size=4, pitch=1, depth=0, length=0, hand=0)  # M6: pitch 1 (the tool's size table says so)
BORE = dict(bore_by=0, bore_diameter=12, bore_offset=3, bore_depth=4, end=0)
SINK = dict(sink_by=0, sink_diameter=12, sink_offset=3, sink_angle=90, end=0)


@pytest.fixture
def block():
    return Topology(load_demo("block"))  # 40 x 30 x 20, top at z = 10


def new_hole(block, tool="add_hole", **params):
    result = run(tool, block, faces=[top_face(block)], **{"diameter": 5, "depth": 0, **params})
    return Topology(result.shape)


def a_bore_wall(topology):
    return next(i for i in range(topology.face_count) if bore_wall(topology, i) is not None)


def removed_between(before, after, z0, z1) -> float:
    def slab(shape):
        return volume(BRepAlgoAPI_Common(shape, BRepPrimAPI_MakeBox(gp_Pnt(-20, -20, z0), 40, 40, z1 - z0).Shape()).Shape())

    return slab(before.shape) - slab(after)


def test_through_hole_thread_cuts_fully_to_both_faces(block):
    hole = new_hole(block)
    threaded = run("thread_hole", hole, faces=[a_bore_wall(hole)], **THREAD).shape
    middle = removed_between(hole, threaded, 0, 1)
    # Before the groove ran one turn short at each end, so the unit next to a face lost only half of what a middle unit loses (1.88 against 3.77).
    assert middle == pytest.approx(3.768, rel=0.02)
    assert removed_between(hole, threaded, 9, 10) == pytest.approx(middle, rel=0.02)
    assert removed_between(hole, threaded, -10, -9) == pytest.approx(middle, rel=0.02)


def test_blind_hole_thread_stops_at_the_bottom_and_leaves_through_the_opening(block):
    hole = new_hole(block, depth=12)  # from z = 10 down to z = -2
    threaded = run("thread_hole", hole, faces=[a_bore_wall(hole)], **THREAD).shape
    middle = removed_between(hole, threaded, 0, 1)
    assert removed_between(hole, threaded, 9, 10) == pytest.approx(middle, rel=0.02)  # the open end now cuts to the face
    assert removed_between(hole, threaded, -2, -1) == pytest.approx(1.884, rel=0.02)  # the bottom stop is where it always was
    assert removed_between(hole, threaded, -10, -2) == pytest.approx(0, abs=1e-6)


def test_thread_goes_to_the_bore_of_a_counterbored_hole(block):
    plain = new_hole(block)
    hole = Topology(run("convert_to_counterbore", plain, faces=[a_bore_wall(plain)], **BORE).shape)
    bore = bore_wall(hole, a_bore_wall(hole))
    assert classify(hole, Selection(faces=[bore]))["thread"] is True
    step = next(i for i in range(hole.face_count) if i != bore and bore_wall(hole, i) == bore)  # the counterbore's wall or floor
    assert classify(hole, Selection(faces=[step]))["thread"] is True
    threaded = run("thread_hole", hole, faces=[step], **THREAD).shape  # any face of the hole leads to the bore wall
    assert removed_between(hole, threaded, 0, 1) == pytest.approx(3.768, rel=0.02)
    assert removed_between(hole, threaded, 6, 10) == pytest.approx(0, abs=1e-6)  # the counterbore's own depth is left alone


def test_counterbore_and_countersink_keep_the_bore_selected(block):
    hole = new_hole(block)
    for tool, params in (("convert_to_counterbore", BORE), ("convert_to_countersink", SINK)):
        result = run(tool, hole, faces=[a_bore_wall(hole)], **params)
        after = Topology(result.shape)
        assert [bore_wall(after, after.face_id(f)) is not None for f in result.tracked_faces] == [True]


def test_thread_then_countersink_and_edit_are_not_blocked(block):
    hole = new_hole(block)
    threaded = Topology(run("thread_hole", hole, faces=[a_bore_wall(hole)], **THREAD).shape)
    assert get_tool("convert_to_countersink").applies(threaded, Selection(faces=[a_bore_wall(threaded)]))
    sunk = Topology(run("convert_to_countersink", threaded, faces=[a_bore_wall(threaded)], **SINK).shape)
    assert volume(sunk.shape) < volume(threaded.shape) - 50
    assert get_tool("edit_hole").applies(threaded, Selection(faces=[a_bore_wall(threaded)]))


def test_a_new_hole_keeps_its_bore_selected_so_a_thread_can_follow(block):
    for tool, extra in (("add_hole", {}), ("add_counterbore", dict(bore_diameter=12, bore_depth=4)), ("add_countersink", dict(sink_diameter=12))):
        result = run(tool, block, faces=[top_face(block)], diameter=5, depth=0, **extra)
        assert len(result.tracked_faces) == 1
        shape = Topology(result.shape)
        threaded = run("thread_hole", shape, faces=[shape.face_id(result.tracked_faces[0])], **THREAD)
        assert volume(threaded.shape) < volume(result.shape) - 20

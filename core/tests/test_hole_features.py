"""The Hole features tool: a new or existing hole with any or all of a counterbore, a countersink and a thread, in one step."""

import pytest
from OCP.BRepAlgoAPI import BRepAlgoAPI_Common
from OCP.BRepPrimAPI import BRepPrimAPI_MakeBox
from OCP.gp import gp_Pnt

from pliable.demos import load_demo
from pliable.holes import find_hole
from pliable.ops import OperationError
from pliable.topology import Topology
from pliable.tools import Selection, get_tool
from test_features import run, volume
from test_holes import top_face

COUNTERBORE = dict(counterbore=1, bore_diameter=12, bore_depth=4)
COUNTERSINK = dict(countersink=1, sink_diameter=12, sink_angle=90)
THREAD = dict(thread=1, thread_size=4)  # M6: pitch 1


@pytest.fixture
def block():
    return Topology(load_demo("block"))  # 40 x 30 x 20, top at z = 10


def make(block, **params):
    return run("hole_features", block, faces=[top_face(block)], **{"diameter": 5, "depth": 0, **params})


def hole_of(topology):
    for i in range(topology.face_count):
        try:
            return find_hole(topology, face_id=i, reach=False)
        except OperationError:
            continue
    raise AssertionError("no hole")


def removed(before, after, z0, z1) -> float:
    def slab(shape):
        return volume(BRepAlgoAPI_Common(shape, BRepPrimAPI_MakeBox(gp_Pnt(-20, -20, z0), 40, 40, z1 - z0).Shape()).Shape())

    return slab(before.shape) - slab(after.shape)


def test_a_plain_hole_matches_add_hole(block):
    a = make(block)
    b = run("add_hole", block, faces=[top_face(block)], diameter=5, depth=0)
    assert volume(a.shape) == pytest.approx(volume(b.shape))


def stepwise(block, step, **thread):
    """The same hole made the long way: Add hole, the helper for the step, then Thread hole on the bore."""
    from pliable.hole_bore import bore_wall

    hole = Topology(run("add_hole", block, faces=[top_face(block)], diameter=5, depth=0).shape)
    wall = next(i for i in range(hole.face_count) if bore_wall(hole, i) == i)
    stepped = Topology(run(step[0], hole, faces=[wall], **step[1]).shape)
    wall = next(i for i in range(stepped.face_count) if bore_wall(stepped, i) == i)
    return run("thread_hole", stepped, faces=[wall], size=4, pitch=1, depth=0, length=0, hand=0).shape


def test_counterbore_and_thread_in_one_step(block):
    one = make(block, **COUNTERBORE, **THREAD).shape
    long = stepwise(block, ("convert_to_counterbore", dict(bore_by=0, bore_diameter=12, bore_offset=3, bore_depth=4, end=0)))
    assert volume(one) == pytest.approx(volume(long), rel=1e-4)
    plain = Topology(make(block).shape)
    assert removed(plain, Topology(one), 0, 1) > 3  # the groove runs the length of the bore, one turn out of the far opening too


def test_countersink_and_thread_in_one_step(block):
    one = make(block, **COUNTERSINK, **THREAD).shape
    long = stepwise(block, ("convert_to_countersink", dict(sink_by=0, sink_diameter=12, sink_offset=3, sink_angle=90, end=0)))
    assert volume(one) == pytest.approx(volume(long), rel=1e-4)
    assert [s["type"] for s in hole_of(Topology(make(block, **COUNTERSINK).shape)).stages] == ["countersink"]
    assert removed(Topology(make(block).shape), Topology(one), -10, -9) == pytest.approx(3.768, rel=0.05)  # threaded to the far opening


def test_counterbore_at_the_opening_and_countersink_at_the_far_end(block):
    both = Topology(make(block, **COUNTERBORE, **COUNTERSINK, sink_end=1).shape)
    info = hole_of(both)
    assert [s["type"] for s in info.stages] == ["counterbore"]
    assert [s["type"] for s in info.end_stages] == ["countersink"]


def test_all_three_features_at_once(block):
    both = make(block, **COUNTERBORE, **COUNTERSINK, sink_end=1)
    threaded = make(block, **COUNTERBORE, **COUNTERSINK, sink_end=1, **THREAD)
    assert volume(threaded.shape) < volume(both.shape) - 3  # the groove took more material out of the bore


def test_a_counterbore_and_a_countersink_at_one_end_are_refused(block):
    with pytest.raises(OperationError, match="same end"):
        make(block, **COUNTERBORE, **COUNTERSINK)


def test_a_far_end_feature_needs_a_through_hole(block):
    with pytest.raises(OperationError, match="far end"):
        make(block, depth=8, **COUNTERSINK, sink_end=1)


def test_an_existing_hole_gets_features_and_a_thread_in_one_step(block):
    hole = Topology(run("add_hole", block, faces=[top_face(block)], diameter=5, depth=0).shape)
    wall = next(i for i in range(hole.face_count) if _is_wall(hole, i))
    result = run("hole_features", hole, faces=[wall], **COUNTERBORE, **COUNTERSINK, sink_end=1, **THREAD)
    steps = run("hole_features", hole, faces=[wall], **COUNTERBORE, **COUNTERSINK, sink_end=1)
    info = hole_of(Topology(steps.shape))
    assert info.stages and info.end_stages
    assert volume(result.shape) < volume(steps.shape) - 3


def test_an_existing_hole_can_be_resized_with_features(block):
    hole = Topology(run("add_hole", block, faces=[top_face(block)], diameter=5, depth=0).shape)
    wall = next(i for i in range(hole.face_count) if _is_wall(hole, i))
    result = run("hole_features", hole, faces=[wall], diameter=4.2, **COUNTERBORE)
    assert hole_of(Topology(result.shape)).diameter == pytest.approx(4.2)
    assert run("hole_features", hole, faces=[wall], diameter=4.2, **COUNTERBORE, **THREAD).shape is not None


def test_switching_features_leaves_the_size_alone(block):
    # The same size with the features on or off: the bore is the same either way, so the size is never lost.
    sizes = {round(hole_of(Topology(make(block, diameter=4.2, **extra).shape)).diameter, 6) for extra in ({}, COUNTERBORE, COUNTERSINK, {**COUNTERBORE, **COUNTERSINK, "sink_end": 1})}
    assert sizes == {4.2}


def test_the_preview_and_the_commit_agree(block):
    tool = get_tool("hole_features")
    params = dict(diameter=5, depth=0, **COUNTERBORE, **THREAD)
    a = tool.execute(block, Selection(faces=[top_face(block)]), params, preview=True)
    b = tool.execute(block, Selection(faces=[top_face(block)]), params, preview=False)
    assert volume(a.shape) == pytest.approx(volume(b.shape))
    assert a.tracked_faces == []  # a preview keeps the flat face picked, as Add hole does


def test_handles_follow_the_features_on(block):
    tool = get_tool("hole_features")
    selection = Selection(faces=[top_face(block)])
    names = {h["param"] for h in tool.handle_list(block, selection, dict(diameter=5, **COUNTERBORE))}
    assert {"diameter", "depth", "bore_diameter", "bore_depth"} <= names


def _is_wall(topology, i):
    from pliable.hole_bore import bore_wall

    return bore_wall(topology, i) == i


def test_one_commit_is_one_undo_step():
    from pliable.protocol import decode_binary
    from pliable.server import Session

    session = Session()
    session.handle({"type": "open_demo", "name": "block"})
    block = Topology(load_demo("block"))
    params = {"diameter": 5, "depth": 0, **COUNTERBORE, **COUNTERSINK, "sink_end": 1, **THREAD}
    session.handle({"type": "tool_commit", "tool": "hole_features", "selection": {"faces": [top_face(block)]}, "params": params})
    document = session._require_document()
    assert volume(document.current.shape) < volume(block.shape) - 100
    session.handle({"type": "undo"})
    assert volume(document.current.shape) == pytest.approx(volume(block.shape))

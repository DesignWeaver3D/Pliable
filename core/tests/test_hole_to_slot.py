"""Hole to slot: a plain round hole stretched along a direction into a slot of the same width and depth."""

import pytest

from pliable.demos import load_demo
from pliable.holes import find_hole
from pliable.ops import OperationError
from pliable.topology import Topology
from test_features import run, volume
from test_holes import top_face


@pytest.fixture
def block():
    return Topology(load_demo("block"))  # 40 x 30 x 20, top at z = 10


def hole_face(topology):
    for i in range(topology.face_count):
        try:
            find_hole(topology, face_id=i, reach=False)
            return i
        except OperationError:
            continue
    raise AssertionError("no hole")


def drilled(block, depth=0):
    return Topology(run("add_hole", block, faces=[top_face(block)], diameter=6, depth=depth).shape)


def test_a_through_hole_becomes_a_through_slot(block):
    hole = drilled(block)
    slot = run("hole_to_slot", hole, faces=[hole_face(hole)], dx=10, dy=0, dz=0)
    assert volume(hole.shape) - volume(slot.shape) == pytest.approx(10 * 6 * 20, rel=1e-4)
    after = Topology(slot.shape)
    with pytest.raises(AssertionError, match="no hole"):  # it is a slot now, not a round hole
        find_hole(after, face_id=hole_face(after), reach=False)


def test_a_blind_hole_keeps_its_depth_and_only_the_part_across_the_axis_counts(block):
    hole = drilled(block, depth=8)
    slot = run("hole_to_slot", hole, faces=[hole_face(hole)], dx=0, dy=-10, dz=5)
    assert volume(hole.shape) - volume(slot.shape) == pytest.approx(10 * 6 * 8, rel=1e-4)


def test_a_counterbored_hole_is_refused(block):
    hole = Topology(run("hole_features", block, faces=[top_face(block)], diameter=6, depth=0, counterbore=1, bore_diameter=12, bore_depth=4).shape)
    with pytest.raises(OperationError, match="counterbore or countersink"):
        run("hole_to_slot", hole, faces=[hole_face(hole)], dx=10)


def test_a_threaded_hole_is_refused(block):
    hole = Topology(run("hole_features", block, faces=[top_face(block)], diameter=5, depth=0, thread=1, thread_size=4).shape)
    with pytest.raises(OperationError):
        run("hole_to_slot", hole, faces=[hole_face(hole)], dx=10)


def test_a_direction_along_the_hole_is_refused(block):
    hole = drilled(block)
    with pytest.raises(OperationError, match="along the hole"):
        run("hole_to_slot", hole, faces=[hole_face(hole)], dz=5)

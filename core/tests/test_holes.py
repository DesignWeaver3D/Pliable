import math

import pytest

from pliable.demos import load_demo
from pliable.holes import find_hole
from pliable.ops import OperationError
from pliable.topology import Topology
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

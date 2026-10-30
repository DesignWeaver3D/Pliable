"""Picked sketch regions keep the sketch's normal, and a selection of solid faces together with loose regions pushes and pulls."""

import pytest
from OCP.BRepGProp import BRepGProp
from OCP.GProp import GProp_GProps

from pliable import sketch
from pliable.demos import load_demo
from pliable.ops import push_pull, solids_of
from pliable.protocol import decode_binary
from pliable.server import Session
from pliable.topology import Topology

# The sketch plane faces +X and lies on the block's -X face (outward normal -X), as when a YZ sketch is moved away from its normal.
PLANE = {"origin": [-20, 0, 0], "normal": [1, 0, 0], "xdir": [0, 1, 0]}


def tombstone():
    """Straight sides with an arc top, a concentric circle, and a concentric arc joined to the sides: three regions."""
    pts = [(1, 0, 0), (2, 8, 0), (3, -8, 0), (4, 8, -8), (5, -8, -8), (6, 5.5, 0), (7, -5.5, 0)]
    entities = [
        {"id": 10, "type": "arc", "center": 1, "start": 2, "end": 3},
        {"id": 11, "type": "line", "a": 3, "b": 5}, {"id": 12, "type": "line", "a": 5, "b": 4}, {"id": 13, "type": "line", "a": 4, "b": 2},
        {"id": 14, "type": "arc", "center": 1, "start": 6, "end": 7},
        {"id": 15, "type": "line", "a": 2, "b": 6}, {"id": 16, "type": "line", "a": 7, "b": 3},
        {"id": 17, "type": "circle", "center": 1, "radius": 3.5},
    ]
    return {"plane": PLANE, "points": [{"id": i, "u": u, "v": v} for i, u, v in pts], "entities": entities, "constraints": []}


def volume(shape) -> float:
    total = 0.0
    for solid in solids_of(shape):
        props = GProp_GProps()
        BRepGProp.VolumeProperties_s(solid, props)
        total += props.Mass()
    return total


def header(reply) -> dict:
    return decode_binary(reply)[0]


def test_every_picked_region_face_has_the_sketch_normal():
    session = Session()
    session.handle({"type": "open_demo", "name": "block"})
    assert len(sketch.regions(tombstone())) == 3
    for picked_regions in ([0, 1], [1, 2], [0, 2], [0, 1, 2]):
        picked = header(session.handle({"type": "sketch_regions", "sketch": tombstone(), "picked_regions": picked_regions}))["selection"]["faces"]
        assert len(picked) == len(picked_regions)
        for index in picked:
            assert sketch.Face(session.document.current.face(index)).normal_at().X == pytest.approx(1.0)
        session.handle({"type": "undo"})


def test_a_solid_face_and_picked_regions_on_it_pull_together():
    session = Session()
    session.handle({"type": "open_demo", "name": "block"})
    before = volume(session.document.current.shape)
    outside = {**tombstone(), "plane": {**PLANE, "origin": [20, 0, 0]}}  # on the +X face, facing the same way as it
    picked = header(session.handle({"type": "sketch_regions", "sketch": outside, "picked_regions": [0, 1]}))["selection"]["faces"]
    topology = Topology(session.document.current.shape)
    side = next(i for i, f in topology.faces() if sketch.Face(f).center().X == pytest.approx(20) and sketch.Face(f).area == pytest.approx(600))
    reply = session.handle({"type": "tool_commit", "tool": "push_pull", "selection": {"faces": [side] + picked}, "params": {"distance": 3}})
    assert isinstance(reply, bytes)  # a solid face and loose regions together do not raise
    assert volume(session.document.current.shape) == pytest.approx(before + 600 * 3, rel=1e-3)  # the regions end up inside the pulled face's body


def test_a_solid_face_and_a_loose_region_pull_as_each_would_alone():
    plane = {"origin": [0, 0, 15], "normal": [0, 0, 1], "xdir": [1, 0, 0]}
    disc = {"plane": plane, "points": [{"id": 1, "u": 0, "v": 0}], "entities": [{"id": 10, "type": "circle", "center": 1, "radius": 3}], "constraints": []}
    block = load_demo("block")
    shape, _ = sketch.add_regions(block, disc)
    base = volume(block)
    topology = Topology(shape)
    top = next(i for i, f in topology.faces() if sketch.Face(f).center().Z == pytest.approx(10) and sketch.Face(f).area == pytest.approx(1200))
    region = next(i for i, f in topology.faces() if sketch.Face(f).center().Z == pytest.approx(15))
    both = push_pull(shape, [topology.face(top), topology.face(region)], 4)
    assert volume(both.shape) == pytest.approx(base + 1200 * 4 + 3.14159265 * 9 * 4, rel=1e-3)
    assert both.tracked_faces


def test_a_mixed_selection_in_new_body_mode_makes_a_body_of_each():
    plane = {"origin": [0, 0, 15], "normal": [0, 0, 1], "xdir": [1, 0, 0]}
    disc = {"plane": plane, "points": [{"id": 1, "u": 0, "v": 0}], "entities": [{"id": 10, "type": "circle", "center": 1, "radius": 3}], "constraints": []}
    shape, _ = sketch.add_regions(load_demo("block"), disc)
    topology = Topology(shape)
    top = next(i for i, f in topology.faces() if sketch.Face(f).center().Z == pytest.approx(10) and sketch.Face(f).area == pytest.approx(1200))
    region = next(i for i, f in topology.faces() if sketch.Face(f).center().Z == pytest.approx(15))
    result = push_pull(shape, [topology.face(top), topology.face(region)], 4, mode="new")
    assert len(solids_of(result.shape)) == 3

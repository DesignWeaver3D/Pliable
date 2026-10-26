"""Resize fillet on a fillet that runs along a chain of edges (the top edges of a block)."""

import pytest
from OCP.Bnd import Bnd_Box
from OCP.BRepBndLib import BRepBndLib
from OCP.BRepGProp import BRepGProp
from OCP.GProp import GProp_GProps

from pliable.demos import load_demo
from pliable.measure import measure
from pliable.ops import fillet_chamfer
from pliable.tools import Selection, get_tool
from pliable.topology import Topology


def volume(shape) -> float:
    props = GProp_GProps()
    BRepGProp.VolumeProperties_s(shape, props)
    return props.Mass()


def top_edges(topology, z):
    out = []
    for i, e in topology.edges():
        box = Bnd_Box()
        BRepBndLib.Add_s(e, box)
        lo, hi = box.CornerMin(), box.CornerMax()
        if abs(lo.Z() - z) < 1e-6 and abs(hi.Z() - z) < 1e-6:
            out.append(i)
    return out


def round_faces(topology, radius):
    found = []
    for i in range(topology.face_count):
        item = measure(topology, Selection(faces=[i]))["items"][0]
        rows = {r["label"]: r["value"] for r in item["rows"]}
        if item["title"] == "Fillet" and abs(rows.get("Radius", 0) - radius) < 1e-6:
            found.append(i)
    return found


def rounded_plate():
    """A block with its four vertical edges rounded (radius 6), then its tangent top loop rounded (radius 3)."""
    block = Topology(load_demo("block"))  # 40 x 30 x 20
    box = Bnd_Box()
    BRepBndLib.Add_s(block.shape, box)
    vertical = []
    for i, e in block.edges():
        b = Bnd_Box()
        BRepBndLib.Add_s(e, b)
        if abs(b.CornerMax().Z() - b.CornerMin().Z()) > 1:
            vertical.append(i)
    assert len(vertical) == 4
    plate = Topology(fillet_chamfer(block.shape, [block.edge(i) for i in vertical], 6).shape)
    top = []
    z = box.CornerMax().Z()
    for i, e in plate.edges():
        b = Bnd_Box()
        BRepBndLib.Add_s(e, b)
        if abs(b.CornerMin().Z() - z) < 1e-6 and abs(b.CornerMax().Z() - z) < 1e-6:
            top.append(i)
    assert len(top) == 8
    return block, Topology(fillet_chamfer(plate.shape, [plate.edge(i) for i in top], 3).shape)


def test_resize_fillet_on_a_chain_of_edges():
    block, chained = rounded_plate()
    plain = volume(chained.shape)
    strips = round_faces(chained, 3)
    assert strips
    tool = get_tool("resize_fillet")
    for strip in strips:
        bigger = tool.execute(chained, Selection(faces=[strip]), {"radius": 4, "end_radius": 0}, preview=False)
        assert round_faces(Topology(bigger.shape), 4)
        assert volume(bigger.shape) < plain
        sharp = tool.execute(chained, Selection(faces=[strip]), {"radius": 0, "end_radius": 0}, preview=False)
        assert volume(sharp.shape) > plain

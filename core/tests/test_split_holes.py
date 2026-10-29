"""A hole whose cylinder is split into two faces (never merged) still has a center and moves, resizes and pulls."""

import math

import pytest
from OCP.BRepAlgoAPI import BRepAlgoAPI_Cut
from OCP.BRepPrimAPI import BRepPrimAPI_MakeCylinder
from OCP.gp import gp_Ax2, gp_Dir, gp_Pnt

from pliable.demos import load_demo
from pliable.holes import find_hole
from pliable.splitwalls import wall_chain
from pliable.tessellate import tessellate
from pliable.topology import Topology
from test_features import run, volume


def split_hole_block():
    """The 40 x 30 x 20 block with a 6 mm hole through its top, cut as two half cylinders so the wall has two faces."""
    shape = load_demo("block")
    for turn in (0.0, math.pi):
        frame = gp_Ax2(gp_Pnt(0, 0, 11), gp_Dir(0, 0, -1), gp_Dir(math.cos(turn), math.sin(turn), 0))
        half = BRepPrimAPI_MakeCylinder(frame, 3.0, 30.0, math.pi).Shape()
        shape = BRepAlgoAPI_Cut(shape, half).Shape()
    return Topology(shape)


def halves(topology):
    out = [i for i in range(topology.face_count) if wall_chain(topology, i) and len(wall_chain(topology, i)) == 2]
    return out


def test_the_split_wall_is_one_chain():
    block = split_hole_block()
    ids = halves(block)
    assert len(ids) == 2 and wall_chain(block, ids[0]) == wall_chain(block, ids[1]) == sorted(ids)


def test_split_hole_is_found_and_both_halves_carry_the_centre():
    block = split_hole_block()
    ids = halves(block)
    info = find_hole(block, face_id=ids[1])
    assert info.diameter == pytest.approx(6.0) and info.through and sorted(info.faces)[:2] == sorted(ids)
    centres = tessellate(block).centres
    assert sorted(c["face"] for c in centres) == sorted(ids)
    assert all(c["length"] == pytest.approx(20.0) and c["position"][:2] == pytest.approx([0, 0], abs=1e-6) for c in centres)


@pytest.mark.parametrize("pick", [0, 1])
def test_push_pull_resize_and_move_a_split_hole(pick):
    block = split_hole_block()
    face = halves(block)[pick]
    base = volume(block.shape)
    handles = __import__("pliable.tools", fromlist=["x"]).get_tool("push_pull")
    assert handles.applies(block, __import__("pliable.tools", fromlist=["x"]).Selection(faces=[face]))
    grown = run("push_pull", block, faces=[face], distance=-1.0)  # wall pushed outward: the hole grows
    assert volume(grown.shape) == pytest.approx(base - math.pi * (16 - 9) * 20, rel=1e-3)
    wider = run("resize_hole", block, faces=[face], diameter=10)
    assert volume(wider.shape) == pytest.approx(base - math.pi * (25 - 9) * 20, rel=1e-3)
    moved = run("move_hole", block, faces=[face], dx=5, dy=0, dz=0)
    assert volume(moved.shape) == pytest.approx(base, rel=1e-3)

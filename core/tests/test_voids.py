"""Square and slot through cuts: found as a straight-walled void, then moved, resized and given another depth."""

import pytest
from build123d import Box, Cylinder, Pos

from pliable.ops import OperationError
from pliable.topology import Topology
from pliable.tools import Selection, get_tool
from pliable.voids import find_void
from test_features import run, volume


def plate_with(cut):
    return Topology(((Box(40, 30, 10)) - cut).wrapped)


def square():
    return plate_with(Box(10, 8, 20))


def slot():
    return plate_with(Box(14, 6, 20) + Pos(7, 0, 0) * Cylinder(3, 20) + Pos(-7, 0, 0) * Cylinder(3, 20))


def walls(topology):
    """Face ids that belong to a through void."""
    found = []
    for i in range(topology.face_count):
        try:
            find_void(topology, i)
        except OperationError:
            continue
        found.append(i)
    return found


@pytest.mark.parametrize("make,count", [(square, 4), (slot, 4)])
def test_through_void_is_found_from_any_wall(make, count):
    part = make()
    ids = walls(part)
    assert len(ids) == count
    info = find_void(part, ids[0])
    assert info.through and info.depth == pytest.approx(10) and info.direction.Z() == pytest.approx(-1)
    assert sorted(info.faces) == sorted(ids)


def test_outer_walls_of_a_block_and_a_post_are_not_voids():
    block = Topology(Box(40, 30, 10).wrapped)
    post = Topology((Box(40, 30, 10) + Pos(0, 0, 10) * Box(6, 6, 10)).wrapped)
    for part in (block, post):
        for i in range(part.face_count):
            try:
                info = find_void(part, i)
            except OperationError:
                continue
            raise AssertionError(f"face {i} read as a void with faces {info.faces}")


def test_round_holes_keep_their_own_tool():
    drilled = Topology((Box(40, 30, 10) - Cylinder(3, 20)).wrapped)
    tool = get_tool("edit_void")
    assert not any(tool.available(drilled, Selection(faces=[i])) for i in range(drilled.face_count))
    part = square()
    assert tool.available(part, Selection(faces=[walls(part)[0]]))


@pytest.mark.parametrize("make,cut_area", [(square, 80.0), (slot, 6 * 14 + 3.14159265 * 9)])
def test_move_resize_and_depth(make, cut_area):
    part = make()
    wall = walls(part)[0]
    base = volume(part.shape)
    moved = run("edit_void", part, faces=[wall], dx=8, dy=3)
    assert volume(moved.shape) == pytest.approx(base, rel=1e-4)
    bigger = Topology(run("edit_void", part, faces=[wall], grow=1.0).shape)
    assert volume(bigger.shape) < base - 10 * 1.0 * 0.9 * 2 * 8  # more than the added perimeter strip
    smaller = run("edit_void", part, faces=[wall], grow=-1.0)
    assert volume(smaller.shape) > base
    blind = Topology(run("edit_void", part, faces=[wall], depth=4).shape)
    assert volume(blind.shape) == pytest.approx(base + cut_area * 6, rel=1e-3)
    again = find_void(blind, walls(blind)[0])
    assert not again.through and again.depth == pytest.approx(4)
    through = Topology(run("edit_void", blind, faces=[walls(blind)[0]], depth=50).shape)
    assert volume(through.shape) == pytest.approx(base, rel=1e-3)


def test_square_grows_by_the_given_distance_each_side():
    part = square()
    wall = walls(part)[0]
    bigger = run("edit_void", part, faces=[wall], grow=1.0)
    # a 10 x 8 cut grown by 1 on each side is 12 x 10 with rounded corners
    expected = 40 * 30 * 10 - 10 * (12 * 10 - (4 - 3.14159265))
    assert volume(bigger.shape) == pytest.approx(expected, rel=1e-3)
    with pytest.raises(OperationError, match="close the cut|nothing"):
        run("edit_void", part, faces=[wall], grow=-5)


def test_handles_follow_the_values():
    part = square()
    wall = walls(part)[0]
    tool = get_tool("edit_void")
    handles = {h["param"]: h for h in tool.handle_list(part, Selection(faces=[wall]), {})}
    assert {"depth", "grow", "dx", "dy"} <= set(handles)
    depth = handles["depth"]
    assert depth["value"] == pytest.approx(10) and depth["max"] == pytest.approx(10) and depth["anchor"][2] == pytest.approx(-5)
    assert depth["direction"] == pytest.approx([0, 0, -1])
    grow = handles["grow"]
    out = grow["direction"]
    assert abs(out[2]) < 1e-9 and grow["value"] == pytest.approx(0)
    moved = {h["param"]: h for h in tool.handle_list(part, Selection(faces=[wall]), {"grow": 2, "dx": 5, "depth": 6})}
    assert moved["depth"]["value"] == pytest.approx(6) and moved["depth"]["anchor"][0] == pytest.approx(5)
    assert moved["grow"]["value"] == pytest.approx(2)


def test_length_and_width_resize_move_only_their_own_ends():
    part = square()  # a 10 x 8 cut through a 40 x 30 x 10 plate: the length is along X
    wall = walls(part)[0]
    base = volume(part.shape)
    longer = run("edit_void", part, faces=[wall], grow_length=2.0)
    assert volume(longer.shape) == pytest.approx(base - 4 * 8 * 10, rel=1e-3)  # 14 x 8
    wider = run("edit_void", part, faces=[wall], grow_width=1.0)
    assert volume(wider.shape) == pytest.approx(base - 10 * 2 * 10, rel=1e-3)  # 10 x 10
    shorter = run("edit_void", part, faces=[wall], grow_length=-1.5)
    assert volume(shorter.shape) == pytest.approx(base + 3 * 8 * 10, rel=1e-3)  # 7 x 8
    with pytest.raises(OperationError, match="close the cut|nothing"):
        run("edit_void", part, faces=[wall], grow_width=-4)


def test_length_and_width_resize_a_slot_and_have_grips():
    part = slot()  # 20 long (14 plus the two round ends) and 6 wide
    wall = walls(part)[0]
    base = volume(part.shape)
    longer = run("edit_void", part, faces=[wall], grow_length=3.0)
    assert volume(longer.shape) == pytest.approx(base - 6 * 6 * 10, rel=1e-3)
    handles = {h["param"]: h for h in get_tool("edit_void").handle_list(part, Selection(faces=[wall]), {"grow_length": 1.0})}
    assert handles["grow_length"]["direction"] == pytest.approx([1, 0, 0])
    assert handles["grow_width"]["direction"] == pytest.approx([0, 1, 0])
    assert handles["grow_length"]["value"] == pytest.approx(1.0)
    assert handles["grow_length"]["anchor"][0] == pytest.approx(10 + 1.0)

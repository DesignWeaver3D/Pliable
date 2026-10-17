import math

import pytest

from pliable.demos import load_demo
from pliable.measure import measure
from pliable.tools import Selection, get_tool
from pliable.topology import Topology
from test_features import faces_where, run, volume


@pytest.fixture
def boss_block():
    block = Topology(load_demo("block"))  # 40 x 30 x 20, top at z = 10
    return Topology(run("add_cylinder", block, diameter=10, height=10, x=0, y=0, z=10).shape)


def boss_face(topology):
    (face,) = faces_where(topology, "Cylinder", Radius=5)
    return face


def test_resize_boss_grows_and_shrinks(boss_block):
    base = volume(boss_block.shape)
    bigger = run("resize_hole", boss_block, faces=[boss_face(boss_block)], diameter=14)
    assert volume(bigger.shape) - base == pytest.approx(math.pi * (49 - 25) * 10, rel=1e-3)
    smaller = run("resize_hole", boss_block, faces=[boss_face(boss_block)], diameter=6)
    assert base - volume(smaller.shape) == pytest.approx(math.pi * (25 - 9) * 10, rel=1e-3)


def test_remove_and_move_boss(boss_block):
    removed = run("fill_hole", boss_block, faces=[boss_face(boss_block)])
    assert volume(removed.shape) == pytest.approx(24000, rel=1e-4)
    moved = run("move_hole", boss_block, faces=[boss_face(boss_block)], dx=8, dy=0, dz=0)
    assert volume(moved.shape) == pytest.approx(volume(boss_block.shape), rel=1e-4)
    copies = run("pattern_hole", boss_block, faces=[boss_face(boss_block)], count=3, dx=12, dy=0, dz=0)
    assert volume(copies.shape) - volume(boss_block.shape) == pytest.approx(2 * math.pi * 25 * 10, rel=1e-3)


def test_circular_pattern_of_a_hole():
    block = Topology(load_demo("block"))
    top = next(i for i in range(6) if measure(block, Selection(faces=[i]))["items"][0]["rows"][3]["value"] == [0.0, 0.0, 1.0])
    one = Topology(run("add_hole", block, faces=[top], diameter=4, depth=0, offset_u=10).shape)
    (wall,) = faces_where(one, "Cylinder", Radius=2)
    ring = run("pattern_hole_circular", one, faces=[wall], count=4, angle=360)
    assert volume(one.shape) - volume(ring.shape) == pytest.approx(3 * math.pi * 4 * 20, rel=1e-3)
    assert len(faces_where(Topology(ring.shape), "Cylinder", Radius=2)) == 4


def test_add_slot_through_and_rotated():
    block = Topology(load_demo("block"))
    top = next(i for i in range(6) if measure(block, Selection(faces=[i]))["items"][0]["rows"][3]["value"] == [0.0, 0.0, 1.0])
    area = (20 - 6) * 6 + math.pi * 9  # straight part plus the two half-discs
    slot = run("add_slot", block, faces=[top], length=20, width=6, depth=0)
    assert volume(block.shape) - volume(slot.shape) == pytest.approx(area * 20, rel=1e-3)
    turned = run("add_slot", block, faces=[top], length=20, width=6, depth=5, angle=90, offset_u=5)
    assert volume(block.shape) - volume(turned.shape) == pytest.approx(area * 5, rel=1e-3)
    with pytest.raises(Exception):
        run("add_slot", block, faces=[top], length=4, width=6)


def test_push_pull_several_coplanar_faces_at_once():
    from pliable.demos import load_demo as demo

    bracket = Topology(demo("bracket"))
    # the base top is split into patches around the upright's fillets; all lie in the z = 5 plane
    from pliable.relations import find_related

    base_top = max((i for i in range(bracket.face_count) if find_related(bracket, i) and find_related(bracket, i)[0]["id"] == "coplanar"), key=lambda i: 0)
    group = [base_top] + find_related(bracket, base_top)[0]["faces"]
    result = run("push_pull", bracket, faces=group, distance=2)
    assert volume(result.shape) > volume(bracket.shape)
    with pytest.raises(Exception):
        run("push_pull", bracket, faces=[group[0], faces_where(bracket, "Cylinder", Radius=7)[0]], distance=2)


def test_center_hole_between_two_faces():
    block = Topology(load_demo("block"))  # x from -20 to 20
    top = next(i for i in range(6) if measure(block, Selection(faces=[i]))["items"][0]["rows"][3]["value"] == [0.0, 0.0, 1.0])
    one = Topology(run("add_hole", block, faces=[top], diameter=4, depth=0, offset_u=-8).shape)
    (wall,) = faces_where(one, "Cylinder", Radius=2)
    sides = [i for i in range(one.face_count) if measure(one, Selection(faces=[i]))["items"][0]["rows"][3]["value"] in ([1.0, 0.0, 0.0], [-1.0, 0.0, 0.0])]
    assert len(sides) == 2
    result = run("center_between", one, faces=[wall] + sides)
    centred = Topology(result.shape)
    (moved,) = faces_where(centred, "Cylinder", Radius=2)
    assert measure(centred, Selection(faces=[moved]))["items"][0]["anchor"][0] == pytest.approx(0, abs=1e-3)
    assert volume(result.shape) == pytest.approx(volume(one.shape), rel=1e-4)


def test_resize_chamfer():
    from pliable.ops import fillet_chamfer

    block = Topology(load_demo("block"))
    edge = max(range(12), key=lambda i: measure(block, Selection(edges=[i]))["items"][0]["rows"][0]["value"])  # a 40 mm edge
    chamfered = Topology(fillet_chamfer(block.shape, [block.edge(edge)], -3).shape)

    def diagonal(i):
        normal = next(r["value"] for r in measure(chamfered, Selection(faces=[i]))["items"][0]["rows"] if r["label"] == "Normal")
        return sum(abs(c) > 1e-9 for c in normal) == 2

    face = next(i for i in range(chamfered.face_count) if diagonal(i))
    bigger = run("resize_chamfer", chamfered, faces=[face], size=5)
    assert volume(block.shape) - volume(bigger.shape) == pytest.approx(0.5 * 25 * 40, rel=1e-3)
    sharp = run("resize_chamfer", chamfered, faces=[face], size=0)
    assert volume(sharp.shape) == pytest.approx(volume(block.shape), rel=1e-4)


def test_cut_plane_offset_body_and_round_face():
    block = Topology(load_demo("block"))  # 40 x 30 x 20, centred on the origin
    cut = run("cut_plane", block, axis=2, position=0, remove_side=1)
    assert volume(cut.shape) == pytest.approx(12000, rel=1e-4)
    low = run("cut_plane", block, axis=0, position=10, remove_side=-1)
    assert volume(low.shape) == pytest.approx(10 * 30 * 20, rel=1e-4)
    with pytest.raises(Exception):
        run("cut_plane", block, axis=2, position=-50, remove_side=1)
    grown = run("offset_body", block, distance=1)
    assert volume(grown.shape) > 24000 + 2 * (40 * 30 + 40 * 20 + 30 * 20) * 0.9
    top = next(i for i in range(6) if measure(block, Selection(faces=[i]))["items"][0]["rows"][3]["value"] == [0.0, 0.0, 1.0])
    rounded = run("round_face", block, faces=[top], distance=2)
    assert Topology(rounded.shape).face_count == 6 + 4  # four fillets
    assert volume(rounded.shape) < 24000


def test_add_boss_on_a_face():
    block = Topology(load_demo("block"))
    top = next(i for i in range(6) if measure(block, Selection(faces=[i]))["items"][0]["rows"][3]["value"] == [0.0, 0.0, 1.0])
    result = run("add_boss", block, faces=[top], diameter=10, height=5, offset_u=5)
    assert volume(result.shape) - 24000 == pytest.approx(math.pi * 25 * 5, rel=1e-3)
    assert faces_where(Topology(result.shape), "Cylinder", Radius=5)

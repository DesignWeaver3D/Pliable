import math

import pytest
from OCP.BRepGProp import BRepGProp
from OCP.GProp import GProp_GProps

from pliable.demos import load_demo
from pliable.measure import measure
from pliable.ops import OperationError
from pliable.tools import Selection, get_tool
from pliable.topology import Topology


def volume(shape) -> float:
    props = GProp_GProps()
    BRepGProp.VolumeProperties_s(shape, props)
    return props.Mass()


def run(tool, topology, faces=(), edges=(), **params):
    return get_tool(tool).execute(topology, Selection(faces=list(faces), edges=list(edges)), params, preview=False)


def faces_where(topology, title, **expected):
    found = []
    for i in range(topology.face_count):
        item = measure(topology, Selection(faces=[i]))["items"][0]
        rows = {r["label"]: r["value"] for r in item["rows"]}
        if item["title"] == title and all(abs(rows[k] - v) < 1e-6 for k, v in expected.items()):
            found.append(i)
    return found


@pytest.fixture
def block():
    return Topology(load_demo("block"))  # 40 x 30 x 20


@pytest.fixture
def bracket():
    return Topology(load_demo("bracket"))


def test_delete_face_heals_a_corner_fillet(bracket):
    before = volume(bracket.shape)
    (fillet, *_) = faces_where(bracket, "Fillet", Radius=6)
    result = run("delete_face", bracket, faces=[fillet])
    assert volume(result.shape) - before == pytest.approx((1 - math.pi / 4) * 36 * 10, rel=1e-3)


def test_remove_round_on_block_chamfer(block):
    from pliable.ops import fillet_chamfer

    chamfered = Topology(fillet_chamfer(block.shape, [block.edge(0)], -3).shape)

    def diagonal(i):
        normal = next(r["value"] for r in measure(chamfered, Selection(faces=[i]))["items"][0]["rows"] if r["label"] == "Normal")
        return all(abs(c) > 0.1 for c in normal if abs(c) > 1e-9) and sum(abs(c) > 1e-9 for c in normal) == 2

    chamfer = next(i for i in range(chamfered.face_count) if diagonal(i))
    result = run("remove_round", chamfered, faces=[chamfer])
    assert volume(result.shape) == pytest.approx(volume(block.shape))


def test_fill_hole_restores_the_plate(bracket):
    before = volume(bracket.shape)
    (hole, *_) = faces_where(bracket, "Cylinder", Radius=4)
    result = run("fill_hole", bracket, faces=[hole])
    assert volume(result.shape) - before == pytest.approx(math.pi * 16 * 10, rel=1e-3)


def test_resize_hole_changes_diameter(bracket):
    before = volume(bracket.shape)
    (wall,) = faces_where(bracket, "Cylinder", Radius=7)
    result = run("resize_hole", bracket, faces=[wall], diameter=20)
    assert before - volume(result.shape) == pytest.approx(math.pi * (100 - 49) * 10, rel=1e-3)
    after = Topology(result.shape)
    assert faces_where(after, "Cylinder", Radius=10)
    shrunk = run("resize_hole", bracket, faces=[wall], diameter=8)
    assert volume(shrunk.shape) - before == pytest.approx(math.pi * (49 - 16) * 10, rel=1e-3)


def test_resize_hole_zero_is_a_no_op(bracket):
    (wall,) = faces_where(bracket, "Cylinder", Radius=7)
    assert run("resize_hole", bracket, faces=[wall], diameter=0).shape.IsSame(bracket.shape)


def test_resize_rejects_non_hole(block):
    with pytest.raises(OperationError):
        run("resize_hole", block, faces=[0], diameter=5)


def test_move_hole_keeps_volume_and_moves_axis(bracket):
    before = volume(bracket.shape)
    (hole, *_) = faces_where(bracket, "Cylinder", Radius=4)
    old = {r["label"]: r["value"] for r in measure(bracket, Selection(faces=[hole]))["items"][0]["rows"]}
    result = run("move_hole", bracket, faces=[hole], dx=0, dy=6, dz=0)
    assert volume(result.shape) == pytest.approx(before, rel=1e-4)
    assert result.shape is not bracket.shape
    moved = Topology(result.shape)
    assert len(faces_where(moved, "Cylinder", Radius=4)) == 4


def test_add_through_hole_on_block(block):
    top = next(i for i in range(6) if measure(block, Selection(faces=[i]))["items"][0]["rows"][3]["value"] == [0.0, 0.0, 1.0])
    result = run("add_hole", block, faces=[top], diameter=6, depth=0)
    assert volume(block.shape) - volume(result.shape) == pytest.approx(math.pi * 9 * 20, rel=1e-3)
    blind = run("add_hole", block, faces=[top], diameter=6, depth=5)
    assert volume(block.shape) - volume(blind.shape) == pytest.approx(math.pi * 9 * 5, rel=1e-3)


def test_pattern_hole_makes_copies(block):
    top = next(i for i in range(6) if measure(block, Selection(faces=[i]))["items"][0]["rows"][3]["value"] == [0.0, 0.0, 1.0])
    one = Topology(run("add_hole", block, faces=[top], diameter=4, depth=0, offset_u=-10).shape)
    (wall,) = faces_where(one, "Cylinder", Radius=2)
    result = run("pattern_hole", one, faces=[wall], count=3, dx=10, dy=0, dz=0)
    assert volume(one.shape) - volume(result.shape) == pytest.approx(2 * math.pi * 4 * 20, rel=1e-3)


def top_of(topology):
    return next(i for i in range(topology.face_count) if measure(topology, Selection(faces=[i]))["items"][0]["rows"][3]["value"] == [0.0, 0.0, 1.0])


def test_add_box_and_cylinder(block):
    box = run("add_box", block, width=10, depth=10, height=10, x=-5, y=-5, z=10)  # sits on the top face
    assert volume(box.shape) == pytest.approx(24000 + 1000)
    cylinder = run("add_cylinder", block, diameter=10, height=10, x=0, y=0, z=10)
    assert volume(cylinder.shape) == pytest.approx(24000 + math.pi * 25 * 10, rel=1e-4)
    assert Topology(box.shape).face_count == 6 + 5  # box top and four walls; the block's top face stays


def test_shell_leaves_walls(block):
    result = run("shell", block, faces=[top_of(block)], thickness=2)
    assert volume(result.shape) == pytest.approx(24000 - 36 * 26 * 18, rel=1e-4)


def test_shell_too_thick_fails_cleanly(block):
    with pytest.raises(OperationError):
        run("shell", block, faces=[top_of(block)], thickness=50)


def test_mirror_doubles_across_a_face(block):
    result = run("mirror", block, faces=[top_of(block)])
    assert volume(result.shape) == pytest.approx(48000)


def test_draft_tilts_side_faces(block):
    side = next(i for i in range(6) if abs(measure(block, Selection(faces=[i]))["items"][0]["rows"][3]["value"][0]) == 1)
    result = run("draft", block, faces=[side], angle=5)
    assert volume(result.shape) != pytest.approx(24000, rel=1e-4)


def test_align_face_moves_first_to_second(bracket):
    up = [i for i in range(bracket.face_count) if measure(bracket, Selection(faces=[i]))["items"][0]["title"] == "Plane" and measure(bracket, Selection(faces=[i]))["items"][0]["rows"][3]["value"] == [0.0, 0.0, 1.0]]
    area = lambda i: measure(bracket, Selection(faces=[i]))["items"][0]["rows"][2]["value"]
    base_top = max(up, key=area)
    upright_top = min(up, key=lambda i: abs(area(i) - 500))  # 10 x 50 top of the upright
    result = run("align_face", bracket, faces=[base_top, upright_top])
    assert volume(result.shape) - volume(bracket.shape) == pytest.approx(40 * area(base_top), rel=1e-3)


def test_align_rejects_non_parallel(bracket):
    with pytest.raises(OperationError):
        run("align_face", bracket, faces=[top_of(bracket), next(i for i in range(bracket.face_count) if i != top_of(bracket) and measure(bracket, Selection(faces=[i]))["items"][0]["rows"][-1]["value"] == [1.0, 0.0, 0.0])])


def test_counterbore_and_countersink(block):
    top = top_of(block)
    cbore = run("add_counterbore", block, faces=[top], diameter=6, depth=0, bore_diameter=12, bore_depth=4)
    assert volume(block.shape) - volume(cbore.shape) == pytest.approx(math.pi * 9 * 20 + math.pi * 27 * 4, rel=1e-3)
    csk = run("add_countersink", block, faces=[top], diameter=6, depth=0, sink_diameter=12, sink_angle=90)
    assert volume(block.shape) - volume(csk.shape) == pytest.approx(math.pi * 9 * 20 + 36 * math.pi, rel=1e-3)
    with pytest.raises(OperationError):
        run("add_counterbore", block, faces=[top], diameter=6, bore_diameter=5)


def hole_centres(topology, radius):
    ids = faces_where(topology, "Cylinder", Radius=radius)
    return sorted(tuple(round(c, 3) for c in measure(topology, Selection(faces=[i]))["items"][0]["anchor"]) for i in ids)


def test_align_and_distribute_holes(block):
    top = top_of(block)
    shape = block
    for x in (-15, -3, 12):  # uneven spacing along X
        shape = Topology(run("add_hole", shape, faces=[top_of(shape)], diameter=4, depth=0, offset_u=x, offset_v=(x % 4)).shape)
    ids = faces_where(shape, "Cylinder", Radius=2)
    assert len(ids) == 3
    aligned = Topology(run("align_holes", shape, faces=ids, axis=1).shape)
    ys = {c[1] for c in hole_centres(aligned, 2)}
    assert len(ys) == 1
    before = [c[0] for c in hole_centres(aligned, 2)]
    ids = faces_where(aligned, "Cylinder", Radius=2)
    spread = Topology(run("distribute_holes", aligned, faces=ids, axis=0).shape)
    xs = [c[0] for c in hole_centres(spread, 2)]
    assert xs[1] - xs[0] == pytest.approx(xs[2] - xs[1], abs=1e-3)
    assert xs[0] == pytest.approx(before[0], abs=1e-3) and xs[2] == pytest.approx(before[2], abs=1e-3)  # outer holes stay put

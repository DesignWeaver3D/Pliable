"""Arrays of a hole copy the whole hole: its counterbore, countersink and thread, so each copy is a full hole with the same parameters."""

import pytest

from pliable.demos import load_demo
from pliable.holes import find_hole
from pliable.ops import OperationError
from pliable.shared.hole_groups import Hole
from pliable.topology import Topology
from test_features import run, volume
from test_holes import top_face

KINDS = {
    "counterbore": dict(counterbore=1, bore_diameter=12, bore_depth=4),
    "countersink": dict(countersink=1, sink_diameter=12, sink_angle=90),
    "thread": dict(thread=1, thread_size=4),
    "all": dict(counterbore=1, bore_diameter=12, bore_depth=4, thread=1, thread_size=4),
}


def one_hole(offset_u=0, **params):
    block = Topology(load_demo("block"))
    made = run("hole_features", block, faces=[top_face(block)], diameter=5, depth=8, offset_u=offset_u, **params)
    return Topology(load_demo("block")), Topology(made.shape)


def holes_of(topology):
    found = {}
    for i in range(topology.face_count):
        try:
            info = find_hole(topology, face_id=i, reach=False)
        except OperationError:
            continue
        found[round(info.entry.X(), 3), round(info.entry.Y(), 3)] = info
    return found


def a_wall(topology):
    """The whole round wall of the 5 mm bore."""
    for i in range(topology.face_count):
        try:
            if abs(Hole.of(topology, i).radius - 2.5) < 1e-6:
                return i
        except OperationError:
            continue
    raise AssertionError("no hole")


def same_hole(a, b):
    assert a.diameter == pytest.approx(b.diameter) and a.depth == pytest.approx(b.depth)
    assert [s["type"] for s in a.stages] == [s["type"] for s in b.stages]
    for x, y in zip(a.stages, b.stages):
        assert x["diameter"] == pytest.approx(y["diameter"]) and x["depth"] == pytest.approx(y["depth"])


@pytest.mark.parametrize("kind", KINDS)
def test_linear_array_copies_the_whole_hole(kind):
    block, holed = one_hole(**KINDS[kind])
    single = volume(block.shape) - volume(holed.shape)
    result = run("linear_array", holed, faces=[a_wall(holed)], count=2, rows=1, dx=12)
    after = Topology(result.shape)
    assert volume(block.shape) - volume(after.shape) == pytest.approx(2 * single, rel=1e-6)
    holes = holes_of(after)
    assert len(holes) == 2
    first, second = sorted(holes.items())
    same_hole(first[1], second[1])


@pytest.mark.parametrize("kind", KINDS)
def test_circular_array_copies_the_whole_hole(kind):
    block, holed = one_hole(offset_u=8, **KINDS[kind])
    single = volume(block.shape) - volume(holed.shape)
    result = run("circular_array", holed, faces=[a_wall(holed)], count=3, axis=2, angle=360)
    assert volume(block.shape) - volume(Topology(result.shape).shape) == pytest.approx(3 * single, rel=1e-6)


def test_concentric_array_copies_the_whole_hole():
    block, holed = one_hole(offset_u=8, **KINDS["all"])
    single = volume(block.shape) - volume(holed.shape)
    result = run("concentric_array", holed, faces=[a_wall(holed)], count=3, rings=1, spacing=0, grow=0, axis=2, axis_edge=-1)
    after = Topology(result.shape)
    assert volume(block.shape) - volume(after.shape) == pytest.approx(3 * single, rel=1e-6)
    holes = list(holes_of(after).values())
    assert len(holes) == 3
    same_hole(holes[0], holes[1])
    same_hole(holes[0], holes[2])


def path_edge_along_x(topology):
    """An edge of the separate 15 mm box (beside the block) whose path runs along +X, a short path so the one copy lands inside the block."""
    from OCP.BRepAdaptor import BRepAdaptor_CompCurve
    from OCP.BRepBuilderAPI import BRepBuilderAPI_MakeWire

    for i in range(topology.edge_count):
        curve = BRepAdaptor_CompCurve(BRepBuilderAPI_MakeWire(topology.edge(i)).Wire())
        start, end = curve.Value(curve.FirstParameter()), curve.Value(curve.LastParameter())
        if start.X() > 40 and end.X() - start.X() == pytest.approx(15):
            return i
    raise AssertionError("no path edge")


def test_path_array_copies_the_whole_hole():
    block, holed = one_hole(offset_u=-8, **KINDS["all"])
    single = volume(block.shape) - volume(holed.shape)
    both = Topology(run("add_box", holed, width=15, depth=10, height=10, x=50, y=0, z=0).shape)
    edge = path_edge_along_x(both)
    result = run("path_array", both, faces=[a_wall(both)], edges=[edge], count=2)
    after = Topology(result.shape)
    assert volume(both.shape) - volume(after.shape) == pytest.approx(single, rel=1e-6)
    assert len(holes_of(after)) == 2

"""Handles (gizmos) declared by face, hole and array tools."""

import pytest

from pliable.demos import load_demo
from pliable.tools import Selection, get_tool
from pliable.topology import Topology


def block():
    return Topology(load_demo("block"))


def test_round_face_has_a_distance_handle_that_follows_the_value():
    topology = block()
    tool = get_tool("round_face")
    selection = Selection(faces=[0])
    near = tool.handles(topology, selection, {"distance": 1})
    far = tool.handles(topology, selection, {"distance": 4})
    assert [h.param for h in near] == ["distance"]
    gap = sum((a - b) ** 2 for a, b in zip(near[0].anchor, far[0].anchor)) ** 0.5
    assert abs(gap - 3) < 1e-6


def top_face(topology):
    from pliable.measure import measure
    from pliable.tools import Selection as S

    best = max(range(topology.face_count), key=lambda i: measure(topology, S(faces=[i]))["items"][0]["anchor"][2])
    return best


def divide(topology, face, **values):
    base = {"across": 0, "offset": 0, "angle": 0, "columns": 0, "rows": 0}
    base.update(values)
    result = get_tool("divide_face").execute(topology, Selection(faces=[face]), base, preview=False)
    return Topology(result.shape)


def test_divide_face_line_angle_and_grid():
    topology = block()
    face = top_face(topology)
    before = topology.face_count
    assert divide(topology, face, offset=3).face_count == before + 1
    assert divide(topology, face, offset=3, angle=30).face_count == before + 1
    assert divide(topology, face, columns=3, rows=2).face_count == before + 5  # 3 x 2 pieces replace one face
    assert divide(topology, face, columns=4).face_count == before + 3


def test_divide_face_handle_only_for_a_single_line():
    topology = block()
    face = top_face(topology)
    tool = get_tool("divide_face")
    one = tool.handles(topology, Selection(faces=[face]), {"across": 0, "offset": 2, "angle": 0, "columns": 0, "rows": 0})
    assert [h.param for h in one] == ["offset"]
    assert not tool.handles(topology, Selection(faces=[face]), {"across": 0, "offset": 2, "angle": 0, "columns": 2, "rows": 0})


def bounds(shape):
    from OCP.Bnd import Bnd_Box
    from OCP.BRepBndLib import BRepBndLib

    box = Bnd_Box()
    BRepBndLib.AddOptimal_s(shape, box, False, False)
    return (box.CornerMin().X(), box.CornerMin().Y(), box.CornerMin().Z()), (box.CornerMax().X(), box.CornerMax().Y(), box.CornerMax().Z())


def volume(shape):
    from OCP.BRepGProp import BRepGProp
    from OCP.GProp import GProp_GProps

    props = GProp_GProps()
    BRepGProp.VolumeProperties_s(shape, props)
    return props.Mass()


def circular(topology, **values):
    base = {"count": 4, "axis": 2, "angle": 360, "axis_edge": -1}
    base.update(values)
    return get_tool("circular_array").execute(topology, Selection(), base, preview=False)


def test_circular_array_has_angle_and_count_handles():
    topology = block()
    handles = get_tool("circular_array").handles(topology, Selection(), {"count": 4, "axis": 2, "angle": 360, "axis_edge": -1})
    assert [h.param for h in handles] == ["angle", "count"]
    assert handles[0].ring is not None and handles[0].axis == (0.0, 0.0, 1.0)


def test_circular_array_about_a_picked_edge_matches_the_global_axis():
    from OCP.BRepAdaptor import BRepAdaptor_Curve
    from OCP.GeomAbs import GeomAbs_Line

    topology = block()
    vertical = next(i for i, e in topology.edges() if BRepAdaptor_Curve(e).GetType() == GeomAbs_Line and abs(BRepAdaptor_Curve(e).Line().Direction().Z()) > 0.99)
    line = BRepAdaptor_Curve(topology.edge(vertical)).Line().Location()
    by_edge = circular(topology, count=2, angle=180, axis=3, axis_edge=vertical)
    lo, hi = bounds(topology.shape)
    new_lo, new_hi = bounds(by_edge.shape)
    # half a turn about a vertical corner edge puts the copy on the other side of that edge in X and Y
    assert (new_hi[0] - new_lo[0]) == pytest.approx(2 * (hi[0] - lo[0]), rel=1e-6)
    assert (new_hi[1] - new_lo[1]) == pytest.approx(2 * (hi[1] - lo[1]), rel=1e-6)
    assert (new_hi[2] - new_lo[2]) == pytest.approx(hi[2] - lo[2], rel=1e-6)
    assert line is not None


def test_circular_array_axis_edge_must_be_picked():
    import pytest

    from pliable.ops import OperationError

    with pytest.raises(OperationError):
        circular(block(), axis=3, axis_edge=-1)


def test_move_hole_has_three_move_arrows_that_follow_the_move():
    topology = Topology(load_demo("bracket"))
    tool = get_tool("move_hole")
    zero = {"dx": 0, "dy": 0, "dz": 0}
    face = next(i for i in range(topology.face_count) if tool.available(topology, Selection(faces=[i])) and tool.handles(topology, Selection(faces=[i]), zero))
    at0 = tool.handles(topology, Selection(faces=[face]), {"dx": 0, "dy": 0, "dz": 0})
    at1 = tool.handles(topology, Selection(faces=[face]), {"dx": 5, "dy": 0, "dz": 0})
    assert [h.param for h in at0] == ["dx", "dy", "dz"] and all(h.kind == "move" for h in at0)
    assert at1[0].anchor[0] - at0[0].anchor[0] == pytest.approx(5)

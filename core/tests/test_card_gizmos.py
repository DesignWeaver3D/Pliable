"""Handles (gizmos) of the card parameters of resize, shell, offset, mirror, revolve, chamfer, array and hole tools."""

import math

import pytest

from pliable.demos import load_demo
from pliable.measure import measure
from pliable.ops import fillet_chamfer
from pliable.tools import Selection, get_tool
from pliable.topology import Topology


def block():
    return Topology(load_demo("block"))  # 40 x 30 x 20


def dist(a, b):
    return math.dist(a, b)


def face_titled(topology, title):
    return [i for i in range(topology.face_count) if measure(topology, Selection(faces=[i]))["items"][0]["title"] == title]


def rounded(distance, chamfer=False):
    """The block with its top edge at x = -20 rounded (or bevelled) by `distance`."""
    base = block()
    shape = fillet_chamfer(base.shape, [base.edge(1)], -distance if chamfer else distance).shape
    return Topology(shape)


def surface_middle(topology, face):
    from OCP.BRepAdaptor import BRepAdaptor_Surface
    from OCP.BRepTools import BRepTools

    u0, u1, v0, v1 = BRepTools.UVBounds_s(topology.face(face))
    p = BRepAdaptor_Surface(topology.face(face)).Value((u0 + u1) / 2, (v0 + v1) / 2)
    return (p.X(), p.Y(), p.Z())


def test_resize_fillet_grip_sits_where_the_resized_fillet_surface_is():
    topology = rounded(3)
    (face,) = face_titled(topology, "Fillet")
    tool = get_tool("resize_fillet")
    selection = Selection(faces=[face])
    for radius in (3, 5):
        handles = tool.handles(topology, selection, {"radius": radius, "end_radius": 0})
        assert [h.param for h in handles] == ["radius"]
        result = tool.execute(topology, selection, {"radius": radius, "end_radius": 0}, preview=False)
        after = Topology(result.shape)
        (new,) = face_titled(after, "Fillet")
        assert dist(handles[0].anchor, surface_middle(after, new)) < 1e-4


def hole_faces(topology):
    from pliable.ops import OperationError
    from pliable.shared.hole_groups import Hole

    out = []
    for i in range(topology.face_count):
        try:
            Hole(topology.face(i))
            out.append(i)
        except OperationError:
            pass
    return out


def test_resize_hole_has_radius_and_diameter_grips_that_show_the_current_size_at_zero():
    topology = Topology(load_demo("bracket"))
    from pliable.shared.hole_groups import Hole

    face = hole_faces(topology)[0]
    selection = Selection(faces=[face])
    tool = get_tool("resize_hole")
    size = 2 * Hole(topology.face(face)).radius
    handles = tool.handles(topology, selection, {"diameter": 0})
    assert [h.param for h in handles] == ["diameter"] * 3
    assert all(h.shown == pytest.approx(size) for h in handles)
    wider = tool.handles(topology, selection, {"diameter": size + 4})
    assert dist(wider[0].anchor, handles[0].anchor) == pytest.approx(2)  # the radius grip moves half the diameter change


def test_shell_grip_starts_on_the_opened_face_rim_and_follows_the_thickness():
    topology = block()
    top = max(range(topology.face_count), key=lambda i: measure(topology, Selection(faces=[i]))["items"][0]["anchor"][2])
    tool = get_tool("shell")
    selection = Selection(faces=[top])
    one = tool.handles(topology, selection, {"thickness": 1})[0]
    four = tool.handles(topology, selection, {"thickness": 4})[0]
    assert one.param == "thickness" and dist(one.anchor, four.anchor) == pytest.approx(3)
    assert one.anchor[2] == pytest.approx(10)  # on the opened face, its wall seen from the rim
    assert abs(one.anchor[0]) <= 20 and abs(one.anchor[1]) <= 15  # inside the face outline
    result = tool.execute(topology, selection, {"thickness": 4}, preview=False)
    assert result.shape is not None


def test_offset_body_grip_sits_on_the_grown_side():
    topology = block()
    tool = get_tool("offset_body")
    for d in (0, 3):
        (handle,) = tool.handles(topology, Selection(), {"distance": d})
        assert handle.anchor[0] == pytest.approx(20 + d) and handle.direction == (1.0, 0.0, 0.0)
    grown = tool.execute(topology, Selection(), {"distance": 3}, preview=False)
    from test_gizmo_tools import bounds

    assert bounds(grown.shape)[1][0] == pytest.approx(23, abs=1e-3)


def test_mirror_grip_follows_the_offset_along_the_plane_normal():
    topology = block()
    tool = get_tool("mirror")
    base = {"plane": 3, "px": 0, "py": 0, "pz": 0, "nx": 0, "ny": 0, "nz": 1}  # the YZ origin plane
    near = tool.handles(topology, Selection(), {**base, "offset": 0})[0]
    far = tool.handles(topology, Selection(), {**base, "offset": 30})[0]
    assert near.param == "offset" and near.direction == pytest.approx((1, 0, 0))
    assert far.anchor[0] - near.anchor[0] == pytest.approx(30) and near.anchor[0] == pytest.approx(0)
    assert tool.handles(topology, Selection(), {**base, "plane": 0, "offset": 0}) == []  # no face selected yet

"""Move edge: the gizmo's snaps square to the faces beside the edge, and the edge moves along the turned gizmo with its faces re-fitted."""

import math

import pytest
from OCP.BRepFilletAPI import BRepFilletAPI_MakeChamfer
from OCP.BRepPrimAPI import BRepPrimAPI_MakeBox

from pliable.ops import planar_normal
from pliable.shared.edge_frame import frame_axes, ring_axes, snap_angles
from pliable.tools import Selection, get_tool
from pliable.topology import Topology
from test_features import volume


def _chamfered_box():
    """A 10 mm cube with the top edge along X at y=0 chamfered 2 mm."""
    from pliable.tools.move_edge import _edge_line

    shape = BRepPrimAPI_MakeBox(10, 10, 10).Shape()
    topology = Topology(shape)
    for i in range(topology.edge_count):
        edge = topology.edge(i)
        mid, direction, _ = _edge_line(edge)
        if abs(direction[0]) > 0.99 and abs(mid[1]) < 1e-6 and abs(mid[2] - 10) < 1e-6:
            maker = BRepFilletAPI_MakeChamfer(shape)
            maker.Add(2.0, edge)
            maker.Build()
            return Topology(maker.Shape())
    raise AssertionError("edge not found")


def _chamfer_top_edge(topology):
    for i in range(topology.edge_count):
        edge = topology.edge(i)
        normals = [planar_normal(f) for f in topology.edge_faces(edge)]
        if len(normals) == 2 and any(abs(n.Z() - 1) < 1e-6 for n in normals) and any(abs(abs(n.Y()) - math.sqrt(0.5)) < 1e-6 for n in normals):
            return i
    raise AssertionError("edge between the top and the chamfer not found")


def test_the_gizmo_starts_square_to_the_global_axes():
    assert frame_axes((0, 0, 0)) == [(1.0, 0.0, 0.0), (0.0, 1.0, 0.0), (0.0, 0.0, 1.0)]
    assert ring_axes((0, 0, 0)) == [(1.0, 0.0, 0.0), (0.0, 1.0, 0.0), (0.0, 0.0, 1.0)]


def test_a_ring_snaps_to_the_chamfer_beside_the_edge():
    topology = _chamfered_box()
    edge = _chamfer_top_edge(topology)
    handles = get_tool("move_edge").handles(topology, Selection(edges=[edge]), {"dx": 0, "dy": 0, "dz": 0, "gx": 0, "gy": 0, "gz": 0})
    rings = {h.param: h for h in handles if h.param.startswith("g")}
    assert any(abs(abs(a) - 45) < 1e-3 for a in rings["gx"].snaps)  # about the edge: z lines up with the 45 degree face's normal
    assert any(abs(a - 90) < 1e-3 for a in rings["gx"].snaps)


def test_snap_angles_find_an_axis_square_to_a_target():
    snaps = snap_angles((0, 0, 0), 0, [(0.0, -math.sqrt(0.5), math.sqrt(0.5))])
    assert any(abs(a - 45) < 1e-6 for a in snaps)


def test_moving_the_chamfer_edge_along_the_turned_gizmo_refits_the_faces():
    topology = _chamfered_box()
    edge = _chamfer_top_edge(topology)
    tool = get_tool("move_edge")
    before = volume(topology.shape)
    # Gizmo turned 45 degrees about X (z now along the chamfer normal), edge pulled 1 mm along it, out of the chamfer face
    result = tool.execute(topology, Selection(edges=[edge]), {"dx": 0, "dy": 0, "dz": 1, "gx": 45, "gy": 0, "gz": 0}, preview=False)
    assert volume(result.shape) != pytest.approx(before)
    assert volume(result.shape) > 0

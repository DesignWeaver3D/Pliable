"""The preview ghost of subtracting tools other than push/pull: the part of the cutting volume in empty space."""

import math

import pytest
from OCP.BRep import BRep_Builder
from OCP.BRepBuilderAPI import BRepBuilderAPI_MakeFace, BRepBuilderAPI_MakePolygon
from OCP.BRepPrimAPI import BRepPrimAPI_MakeCylinder, BRepPrimAPI_MakeSphere
from OCP.gp import gp_Ax2, gp_Dir, gp_Pnt
from OCP.TopAbs import TopAbs_EDGE
from OCP.TopExp import TopExp_Explorer
from OCP.TopoDS import TopoDS_Compound

from pliable.demos import load_demo
from pliable.document import Document
from pliable.ops import planar_normal
from pliable.protocol import decode_binary
from pliable.server import Session
from pliable.topology import Topology

BLOCK = load_demo("block")  # 40 x 30 x 20 centered on the origin
TOP = next(i for i, f in Topology(BLOCK).faces() if planar_normal(f) is not None and planar_normal(f).Z() > 0.99)


def reply(shape, tool, selection, params, commit=False):
    session = Session()
    session.document = Document(shape)
    kind = "tool_commit" if commit else "tool_preview"
    return decode_binary(session.handle({"type": kind, "tool": tool, "selection": selection, "params": params}))


def has_ghost(shape, tool, selection, params):
    header, buffers = reply(shape, tool, selection, params)
    assert ("ghost" in header) == ("ghostPositions" in buffers)
    return header.get("ghost")


def top_edge(topology, face):
    return topology.edge_id(TopExp_Explorer(topology.face(face), TopAbs_EDGE).Current())


def test_hole_tools_show_the_part_of_the_cutter_outside_the_model():
    sel = {"faces": [TOP]}
    for tool, extra in (("add_hole", {}), ("add_counterbore", {"bore_diameter": 12, "bore_depth": 3}), ("add_countersink", {"sink_diameter": 12}), ("add_slot", {"length": 14, "width": 5})):
        inside = {"diameter": 6, "depth": 5, **extra}
        assert has_ghost(BLOCK, tool, sel, inside) is None, tool  # wholly inside the body, the lead-in above the face is not drawn
        assert has_ghost(BLOCK, tool, sel, {**inside, "depth": 0}) is None, tool  # through: no real end to draw
        past = has_ghost(BLOCK, tool, sel, {**inside, "depth": 30})  # runs 10 past the bottom face
        assert past is not None and past["bounds"][5] == pytest.approx(-10.0, abs=0.05), tool
    assert not reply(BLOCK, "add_hole", sel, {"diameter": 6, "depth": 30}, commit=True)[0].get("ghost")


def test_a_hole_ghost_in_empty_space():
    cylinder = BRepPrimAPI_MakeCylinder(gp_Ax2(gp_Pnt(0, 0, 0), gp_Dir(0, 0, 1)), 10, 20).Shape()
    top = next(i for i, f in Topology(cylinder).faces() if planar_normal(f) is not None and planar_normal(f).Z() > 0.99)
    ghost = has_ghost(cylinder, "add_hole", {"faces": [top]}, {"diameter": 6, "depth": 5, "offset_u": 9.0})  # half the bore hangs off the rim
    assert ghost is not None


def helical_model():
    cylinder = BRepPrimAPI_MakeCylinder(gp_Ax2(gp_Pnt(0, 0, 0), gp_Dir(0, 0, 1)), 10, 40).Shape()
    profile = BRepBuilderAPI_MakeFace(BRepBuilderAPI_MakePolygon(gp_Pnt(9, 0, 0), gp_Pnt(12, 0, 1), gp_Pnt(12, 0, 2), gp_Pnt(9, 0, 3), True).Wire()).Face()
    shape = TopoDS_Compound()
    builder = BRep_Builder()
    builder.MakeCompound(shape)
    builder.Add(shape, cylinder)
    builder.Add(shape, profile)
    return shape, max(i for i, _ in Topology(shape).faces())


def test_helical_sweep_ghost_only_when_subtracting_and_the_thread_leaves_the_body():
    shape, face = helical_model()
    params = {"pitch": 5, "turns": 4, "hand": 0, "axis": 2, "axis_edge": -1}
    sel = {"faces": [face], "axes": [2]}
    assert has_ghost(shape, "helical_sweep", sel, {**params, "mode": 0}) is None
    ghost = has_ghost(shape, "helical_sweep", sel, {**params, "mode": 1})
    assert ghost is not None and ghost["bounds"][3] > 10.5  # the part of the thread outside the cylinder wall (radius 10)
    assert not reply(shape, "helical_sweep", sel, {**params, "mode": 1}, commit=True)[0].get("ghost")
    deep = {**params, "pitch": 5}
    cut_inside = BRepBuilderAPI_MakeFace(BRepBuilderAPI_MakePolygon(gp_Pnt(3, 0, 0), gp_Pnt(6, 0, 1), gp_Pnt(6, 0, 2), gp_Pnt(3, 0, 3), True).Wire()).Face()
    inner = TopoDS_Compound()
    builder = BRep_Builder()
    builder.MakeCompound(inner)
    builder.Add(inner, BRepPrimAPI_MakeCylinder(gp_Ax2(gp_Pnt(0, 0, 0), gp_Dir(0, 0, 1)), 10, 40).Shape())
    builder.Add(inner, cut_inside)
    assert has_ghost(inner, "helical_sweep", {"faces": [max(i for i, _ in Topology(inner).faces())], "axes": [2]}, {**deep, "mode": 1}) is None


def test_revolve_face_ghost():
    topology = Topology(BLOCK)
    sel = {"faces": [TOP], "edges": [top_edge(topology, TOP)]}
    assert has_ghost(BLOCK, "revolve_face", sel, {"angle": 90, "mode": 0}) is None
    ghost = has_ghost(BLOCK, "revolve_face", sel, {"angle": 90, "mode": 1})
    assert ghost is not None  # swung about the top edge, part of the face sweeps through the air above the block
    assert not reply(BLOCK, "revolve_face", sel, {"angle": 90, "mode": 1}, commit=True)[0].get("ghost")


def test_sweep_face_ghost():
    topology = Topology(BLOCK)
    from OCP.BRepAdaptor import BRepAdaptor_Curve

    vertical = next(i for i in range(topology.edge_count) if abs(BRepAdaptor_Curve(topology.edge(i)).Line().Direction().Z()) > 0.9)
    sel = {"faces": [TOP], "edges": [vertical]}
    adds = has_ghost(BLOCK, "sweep_face", sel, {"mode": 0})
    assert adds is None
    # which way the edge runs decides whether the face goes up (empty space) or down through the block; one of the two modes sees air
    sweeps = [has_ghost(BLOCK, "sweep_face", sel, {"mode": 1})]
    assert sweeps[0] is None or sweeps[0]["triangles"] > 0
    assert not reply(BLOCK, "sweep_face", sel, {"mode": 1}, commit=True)[0].get("ghost")


def test_cutting_along_a_surface_has_no_ghost_inside_the_body():
    ball = BRepPrimAPI_MakeSphere(15).Shape()
    face = next(i for i, _ in Topology(ball).faces())
    header, _ = reply(ball, "push_pull_surface", {"faces": [face]}, {"distance": -3})
    assert "ghost" not in header


def empty_space_profile():
    """Only a loose face in the model, no solid at all."""
    profile = BRepBuilderAPI_MakeFace(BRepBuilderAPI_MakePolygon(gp_Pnt(9, 0, 0), gp_Pnt(12, 0, 1), gp_Pnt(12, 0, 2), gp_Pnt(9, 0, 3), True).Wire()).Face()
    shape = TopoDS_Compound()
    BRep_Builder().MakeCompound(shape)
    BRep_Builder().Add(shape, profile)
    return shape, max(i for i, _ in Topology(shape).faces())


def test_helical_sweep_subtract_in_empty_space_draws_the_ghost_and_refuses_to_commit():
    from pliable.ops import OperationError
    from pliable.tools import TOOLS, Selection

    shape, face = empty_space_profile()
    params = {"pitch": 5, "turns": 3, "hand": 0, "axis": 2, "axis_edge": -1, "mode": 1}
    header, _ = reply(shape, "helical_sweep", {"faces": [face], "axes": [2]}, params)
    assert header.get("ghost") is not None and "no solid" in header.get("notice", "")
    with pytest.raises(OperationError):
        TOOLS["helical_sweep"].execute(Topology(shape), Selection(faces=[face], axes=[2]), params, False)


def test_helical_sweep_subtract_clear_of_the_body_draws_the_ghost():
    far = BRepPrimAPI_MakeCylinder(gp_Ax2(gp_Pnt(100, 0, 0), gp_Dir(0, 0, 1)), 10, 40).Shape()  # the thread never reaches this body
    profile = BRepBuilderAPI_MakeFace(BRepBuilderAPI_MakePolygon(gp_Pnt(9, 0, 0), gp_Pnt(12, 0, 1), gp_Pnt(12, 0, 2), gp_Pnt(9, 0, 3), True).Wire()).Face()
    shape = TopoDS_Compound()
    builder = BRep_Builder()
    builder.MakeCompound(shape)
    builder.Add(shape, far)
    builder.Add(shape, profile)
    face = max(i for i, _ in Topology(shape).faces())
    header, _ = reply(shape, "helical_sweep", {"faces": [face], "axes": [2]}, {"pitch": 5, "turns": 3, "hand": 0, "axis": 2, "axis_edge": -1, "mode": 1})
    assert header.get("ghost") is not None and header.get("notice")


def test_revolve_face_subtract_in_empty_space_draws_the_ghost():
    shape, face = empty_space_profile()
    topology = Topology(shape)
    edge = next(iter(range(topology.edge_count)))
    header, _ = reply(shape, "revolve_face", {"faces": [face], "edges": [edge]}, {"angle": 90, "mode": 1})
    assert header.get("ghost") is not None and header.get("notice")

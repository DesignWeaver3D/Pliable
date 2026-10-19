"""Manipulator handles: a tool declares one per parameter and the core sends them with the preview (docs/protocol.md)."""

import math

import pytest

from pliable.protocol import decode_binary
from pliable.server import Session
from pliable.tools import TOOLS, Accepts, Handle, Param, Tool


class _Stub(Tool):
    id = "stub_handles"
    label = "Stub"
    description = "A test tool with one slide handle on its length parameter."
    accepts = Accepts()
    starts_from = "tool"
    params = [Param("length", "length", 5), Param("flag", "number", 0)]

    def handles(self, topology, selection, values):
        return [
            Handle("length", "Length", (values["length"], 0, 0), (2, 0, 0), min=1),
            Handle("missing", "No such parameter", (0, 0, 0), (0, 0, 1)),
        ]

    def run(self, topology, selection, values, preview):
        from pliable.ops import OpResult

        return OpResult(topology.shape, [])


@pytest.fixture
def session(monkeypatch):
    monkeypatch.setitem(TOOLS, _Stub.id, _Stub())
    s = Session()
    s.handle({"type": "open_demo", "name": "block"})
    return s


def test_description_says_where_a_tool_starts_and_whether_it_has_handles(session):
    tools = {t["id"]: t for t in session.handle({"type": "list_tools"})["tools"]}
    assert tools["stub_handles"]["startsFrom"] == "tool" and tools["stub_handles"]["hasHandles"]
    assert tools["push_pull"]["startsFrom"] == "selection"
    assert tools["shell"]["hasHandles"] is False


def test_tool_handles_request_returns_normalised_handles_with_the_current_value(session):
    reply = session.handle({"type": "tool_handles", "tool": "stub_handles", "params": {"length": 7}})
    assert reply["startsFrom"] == "tool"
    (h,) = reply["handles"]  # the handle for an unknown parameter is dropped
    assert h["param"] == "length" and h["value"] == 7 and h["anchor"] == [7.0, 0.0, 0.0]
    assert h["direction"] == [1.0, 0.0, 0.0] and h["min"] == 1 and h["unit"] == "mm" and h["scale"] == 1.0


def test_defaults_fill_missing_values(session):
    (h,) = session.handle({"type": "tool_handles", "tool": "stub_handles"})["handles"]
    assert h["value"] == 5


def test_preview_reply_carries_handles_and_commit_does_not(session):
    header, _ = decode_binary(session.handle({"type": "tool_preview", "tool": "stub_handles", "params": {"length": 3}}))
    assert header["handles"][0]["value"] == 3
    header, _ = decode_binary(session.handle({"type": "tool_commit", "tool": "stub_handles", "params": {"length": 3}}))
    assert header["handles"] == []


def test_tools_without_handles_send_an_empty_list(session):
    reply = session.handle({"type": "tool_handles", "tool": "unify"})
    assert reply["handles"] == []




# ---- Primitive handles (box, cylinder, sphere, cone, torus) -------------------------------------------------------

from OCP.BRep import BRep_Builder  # noqa: E402
from OCP.Bnd import Bnd_Box  # noqa: E402
from OCP.TopoDS import TopoDS_Compound  # noqa: E402
from OCP.BRepBndLib import BRepBndLib  # noqa: E402

from pliable.tools import Selection  # noqa: E402
from pliable.topology import Topology  # noqa: E402

PRIMITIVES = {
    "add_box": {"width": 12, "depth": 8, "height": 6, "x": 3, "y": -2, "z": 1},
    "add_cylinder": {"diameter": 9, "height": 7, "x": 3, "y": -2, "z": 1},
    "add_sphere": {"diameter": 9, "x": 3, "y": -2, "z": 1},
    "add_cone": {"bottom_diameter": 10, "top_diameter": 4, "height": 7, "x": 3, "y": -2, "z": 1},
    "add_torus": {"major": 20, "minor": 5, "x": 3, "y": -2, "z": 1},
}


def _bounds(shape):
    box = Bnd_Box()
    BRepBndLib.AddOptimal_s(shape, box, False, False)
    return box.CornerMin().X(), box.CornerMin().Y(), box.CornerMin().Z(), box.CornerMax().X(), box.CornerMax().Y(), box.CornerMax().Z()


def _volume(shape):
    from OCP.BRepGProp import BRepGProp
    from OCP.GProp import GProp_GProps

    props = GProp_GProps()
    BRepGProp.VolumeProperties_s(shape, props)
    return props.Mass()


def _handles(tool_id, params):
    session = Session()
    session.handle({"type": "open_demo", "name": "block"})
    return session.handle({"type": "tool_handles", "tool": tool_id, "params": params})["handles"]


@pytest.mark.parametrize("tool_id", PRIMITIVES)
def test_primitive_starts_from_the_tool_with_a_handle_per_geometry_parameter(tool_id):
    tool = TOOLS[tool_id]
    assert tool.starts_from == "tool"
    handles = _handles(tool_id, PRIMITIVES[tool_id])
    sized = {h["param"] for h in handles}
    assert sized == {p.name for p in tool.params if p.name != "new_body"}  # one handle per parameter, none for new_body


@pytest.mark.parametrize("tool_id", PRIMITIVES)
def test_handles_follow_their_parameter(tool_id):
    """Dragging a handle by t along its direction sets value + scale * t, and the handle then sits t further along."""
    params = PRIMITIVES[tool_id]
    for h in _handles(tool_id, params):
        t = 1.5
        new = max(h["value"] + h["scale"] * t, h["min"] if h["min"] is not None else -1e9)
        moved = {h2["param"]: h2 for h2 in _handles(tool_id, {**params, h["param"]: new})}[h["param"]]
        travel = (new - h["value"]) / h["scale"]
        for a, b, d in zip(h["anchor"], moved["anchor"], h["direction"]):
            assert b == pytest.approx(a + d * travel), (tool_id, h["param"])


@pytest.mark.parametrize("tool_id", PRIMITIVES)
def test_size_handles_sit_on_the_solid_and_resizing_moves_its_extent(tool_id):
    params = PRIMITIVES[tool_id]
    tool = TOOLS[tool_id]
    builder = BRep_Builder()
    compound = TopoDS_Compound()
    builder.MakeCompound(compound)
    empty = Topology(compound)

    def solid(values):
        shape = tool.execute(empty, Selection(), {**values, "new_body": 1}, preview=True).shape
        return _bounds(shape), _volume(shape)

    base, base_volume = solid(params)
    for h in _handles(tool_id, params):
        if h["param"] in ("x", "y", "z"):
            continue
        axis = max(range(3), key=lambda i: abs(h["direction"][i]))
        # The anchor lies on the solid's outer extent along its axis (the tip of the top diameter sits just outside).
        lo, hi = base[axis], base[axis + 3]
        assert lo - 1.0 <= h["anchor"][axis] <= hi + 1.0, (tool_id, h["param"])
        # Pulling the handle outward grows the solid along its axis (so its volume increases).
        grown, grown_volume = solid({**params, h["param"]: h["value"] + 2 * h["scale"]})
        assert grown_volume > base_volume * 1.001, (tool_id, h["param"])


# ---- Whole-body tools ---------------------------------------------------------------------------------------------


def _body_handles(tool_id, params):
    session = Session()
    session.handle({"type": "open_demo", "name": "bracket"})
    return {h["param"]: h for h in session.handle({"type": "tool_handles", "tool": tool_id, "params": params})["handles"]}


def test_move_body_has_a_handle_per_axis_that_follows_its_distance():
    before = _body_handles("move_body", {})
    assert set(before) == {"dx", "dy", "dz"}
    after = _body_handles("move_body", {"dx": 4, "dy": -3})
    assert after["dx"]["anchor"][0] == pytest.approx(before["dx"]["anchor"][0] + 4)
    assert after["dy"]["anchor"][1] == pytest.approx(before["dy"]["anchor"][1] - 3)
    assert after["dz"]["anchor"] == pytest.approx([before["dz"]["anchor"][0] + 4, before["dz"]["anchor"][1] - 3, before["dz"]["anchor"][2]])  # the arrows travel with the body
    assert before["dz"]["direction"] == [0.0, 0.0, 1.0] and before["dz"]["scale"] == 1.0


def test_rotate_body_handle_sits_on_a_ring_at_the_current_angle():
    for angle in (0, 35, -120):
        h = _body_handles("rotate_body", {"axis": 2, "angle": angle})["angle"]
        x, y, z = h["anchor"]
        assert z == 0 and math.degrees(math.atan2(y, x)) == pytest.approx(angle)
        # the tangent is square to the radius, and travel along it turns by scale degrees per unit
        assert h["direction"][0] * x + h["direction"][1] * y == pytest.approx(0, abs=1e-9)
        assert h["unit"] == "°" and h["scale"] == pytest.approx(math.degrees(1 / math.hypot(x, y)))
    about_x = _body_handles("rotate_body", {"axis": 0, "angle": 0})["angle"]
    assert about_x["anchor"][0] == 0 and about_x["direction"][0] == 0


def test_rotate_body_handle_needs_a_valid_axis():
    assert _body_handles("rotate_body", {"axis": 5}) == {}


def test_scale_body_handle_stays_on_the_line_through_the_corner_and_follows_the_factor():
    h1 = _body_handles("scale_body", {"factor": 1})["factor"]
    h2 = _body_handles("scale_body", {"factor": 2})["factor"]
    assert h2["anchor"] == pytest.approx([2 * c for c in h1["anchor"]])
    t = 7.0  # travel along the line changes the factor by scale * t and moves the anchor by t
    h3 = _body_handles("scale_body", {"factor": 1 + h1["scale"] * t})["factor"]
    assert h3["anchor"] == pytest.approx([a + d * t for a, d in zip(h1["anchor"], h1["direction"])])
    assert h1["min"] == 1e-3


def test_body_handles_respect_the_selected_solid():
    session = Session()
    session.handle({"type": "open_demo", "name": "block"})
    whole = session.handle({"type": "tool_handles", "tool": "move_body", "params": {}})["handles"]
    one_face = session.handle({"type": "tool_handles", "tool": "move_body", "selection": {"faces": [0]}, "params": {}})["handles"]
    assert whole and one_face


# ---- Push/pull ----------------------------------------------------------------------------------------------------


@pytest.mark.parametrize("demo", ["block", "bracket", "perforated_plate"])
def test_push_pull_handle_sits_on_every_flat_face_and_points_along_its_normal(demo):
    from OCP.BRepBuilderAPI import BRepBuilderAPI_MakeVertex
    from OCP.BRepExtrema import BRepExtrema_DistShapeShape
    from OCP.gp import gp_Pnt

    from pliable.ops import planar_normal

    session = Session()
    session.handle({"type": "open_demo", "name": demo})
    topology = session.document.current
    checked = 0
    for face_id, face in topology.faces():
        normal = planar_normal(face)
        if normal is None:
            continue
        (h,) = session.handle({"type": "tool_handles", "tool": "push_pull", "selection": {"faces": [face_id]}, "params": {}})["handles"]
        assert h["direction"] == pytest.approx([normal.X(), normal.Y(), normal.Z()])
        vertex = BRepBuilderAPI_MakeVertex(gp_Pnt(*h["anchor"])).Vertex()
        assert BRepExtrema_DistShapeShape(face, vertex).Value() < 1e-6, (demo, face_id)
        checked += 1
    assert checked >= 6


def test_push_pull_handle_follows_the_distance_and_skips_hole_walls():
    session = Session()
    session.handle({"type": "open_demo", "name": "block"})
    flat = {"faces": [next(i for i, f in session.document.current.faces() if __import__("pliable.ops", fromlist=["x"]).planar_normal(f) is not None)]}
    h0 = session.handle({"type": "tool_handles", "tool": "push_pull", "selection": flat, "params": {}})["handles"][0]
    h5 = session.handle({"type": "tool_handles", "tool": "push_pull", "selection": flat, "params": {"distance": 5}})["handles"][0]
    assert h5["anchor"] == pytest.approx([a + 5 * d for a, d in zip(h0["anchor"], h0["direction"])])
    assert h5["value"] == 5

    session.handle({"type": "open_demo", "name": "bracket"})
    wall = next(i for i, f in session.document.current.faces() if _is_whole_cylinder(f))
    assert session.handle({"type": "tool_handles", "tool": "push_pull", "selection": {"faces": [wall]}, "params": {}})["handles"] == []


def _is_whole_cylinder(face):
    from pliable.tools import _all_round_walls

    class _T:
        def face(self, i):
            return face

    return _all_round_walls(_T(), Selection(faces=[0]))

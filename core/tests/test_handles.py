"""Manipulator handles: a tool declares one per parameter and the core sends them with the preview (docs/protocol.md)."""

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
    assert h["direction"] == [1.0, 0.0, 0.0] and h["min"] == 1 and h["kind"] == "slide" and h["scale"] == 1.0


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


def test_bad_handle_kind_is_rejected():
    with pytest.raises(ValueError):
        Handle("a", "A", (0, 0, 0), (1, 0, 0), kind="spin")


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

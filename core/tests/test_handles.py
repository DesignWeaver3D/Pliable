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

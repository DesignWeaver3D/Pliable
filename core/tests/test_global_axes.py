"""Global axes (X, Y, Z lines through the origin) picked in the view and used as an axis by Revolve face."""

import pytest
from OCP.BRepGProp import BRepGProp
from OCP.GProp import GProp_GProps

from pliable.ops import planar_normal
from pliable.server import Session


def _volume(session) -> float:
    props = GProp_GProps()
    BRepGProp.VolumeProperties_s(session.document.current.shape, props)
    return props.Mass()


def _block():
    s = Session()
    s.handle({"type": "open_demo", "name": "block"})
    topology = s.document.current
    top = max((planar_normal(f).X(), i) for i, f in topology.faces() if planar_normal(f) is not None)[1]  # the +X end face; revolved about Z it sweeps round the block
    return s, top


def _tools(session, selection):
    return session.handle({"type": "available_tools", "selection": selection})["tools"]


def test_revolve_face_is_offered_with_a_face_only_and_with_a_global_axis():
    s, top = _block()
    assert "revolve_face" in _tools(s, {"faces": [top]})
    assert "revolve_face" in _tools(s, {"faces": [top], "axes": [0]})
    assert "revolve_face" not in _tools(s, {"faces": [top], "axes": [0, 1]})
    assert "revolve_face" not in _tools(s, {"axes": [0]})
    assert "push_pull" not in _tools(s, {"faces": [top], "axes": [0]})  # tools that take no axis ignore a selection that has one


@pytest.mark.parametrize("selection, params", [
    ({"faces": "top", "axes": [2]}, {"angle": 90}),  # the selected global axis
    ({"faces": "top"}, {"angle": 90, "axis": 2}),  # picked after starting the tool, from the form's list
])
def test_revolve_face_about_a_global_axis(selection, params):
    s, top = _block()
    before = _volume(s)
    selection = {**selection, "faces": [top]}
    s.handle({"type": "tool_commit", "tool": "revolve_face", "selection": selection, "params": params})
    assert _volume(s) > before + 100


def test_revolve_face_without_an_axis_says_what_is_missing():
    s, top = _block()
    with pytest.raises(Exception, match="Pick the axis"):
        s.handle({"type": "tool_commit", "tool": "revolve_face", "selection": {"faces": [top]}, "params": {"angle": 90}})


"""A kept sketch's curves as the path of Sweep face along edge and Array along path."""

import pytest
from OCP.BRepBndLib import BRepBndLib
from OCP.Bnd import Bnd_Box

from pliable.ops import OperationError
from pliable.server import RequestError, Session

from test_features import volume
from test_sketch import sketch_of


def bounds(shape):
    box = Bnd_Box()
    BRepBndLib.Add_s(shape, box)
    lo, hi = box.CornerMin(), box.CornerMax()
    return (hi.X() - lo.X(), hi.Y() - lo.Y(), hi.Z() - lo.Z())


def session_with_path(points, lines, plane="XY"):
    session = Session()
    session.handle({"type": "open_demo", "name": "block"})
    sk = sketch_of(points, lines, plane=session.handle({"type": "sketch_plane", "plane": plane})["plane"])
    session.handle({"type": "sketch_keep", "sketch": sk})
    return session


def bent_path():
    points = [{"id": 1, "u": 0, "v": 0}, {"id": 2, "u": 40, "v": 0}, {"id": 3, "u": 40, "v": 30}]
    lines = [{"id": 11, "type": "line", "a": 1, "b": 2}, {"id": 12, "type": "line", "a": 2, "b": 3}]
    return points, lines


def test_array_along_a_kept_sketch_path():
    session = session_with_path(*bent_path())
    before = volume(session.document.current.shape)
    session.handle({"type": "tool_commit", "tool": "path_array", "selection": {"rail": 1}, "params": {"count": 3}})
    shape = session.document.current.shape
    assert volume(shape) > before
    assert bounds(shape) == pytest.approx((80, 60, 20), abs=1e-3)  # the last copy sits at the end of the path (40, 30)


def test_a_sketch_path_makes_the_tools_available_without_edges():
    session = session_with_path(*bent_path())
    top = 0
    without = session.handle({"type": "available_tools", "selection": {"faces": [top]}})["tools"]
    withrail = session.handle({"type": "available_tools", "selection": {"faces": [top], "rail": 1}})["tools"]
    assert "path_array" not in without and "path_array" in withrail
    assert "sweep_face" not in without and "sweep_face" in withrail
    stale = session.handle({"type": "available_tools", "selection": {"faces": [top], "rail": 9}})["tools"]
    assert "sweep_face" not in stale  # a sketch that is gone offers nothing


def test_sweep_a_face_along_a_kept_sketch_path():
    points = [{"id": 1, "u": 0, "v": 20}, {"id": 2, "u": 0, "v": 50}, {"id": 3, "u": 30, "v": 50}]
    lines = [{"id": 11, "type": "line", "a": 1, "b": 2}, {"id": 12, "type": "line", "a": 2, "b": 3}]
    session = session_with_path(points, lines, plane="XZ")
    topology = session.document.current
    from pliable.ops import planar_normal

    top = max((planar_normal(f).Z(), i) for i, f in topology.faces() if planar_normal(f) is not None)[1]
    # the path rises 30 from the top face, then runs 30 along X; mode 0 adds the swept solid
    session.handle({"type": "tool_commit", "tool": "sweep_face", "selection": {"faces": [top], "rail": 1}, "params": {"mode": 0}})
    assert volume(session.document.current.shape) > 24000 + 1000


def test_a_sketch_that_does_not_join_is_refused():
    points = [{"id": 1, "u": 0, "v": 0}, {"id": 2, "u": 10, "v": 0}, {"id": 3, "u": 30, "v": 5}, {"id": 4, "u": 40, "v": 5}]
    lines = [{"id": 11, "type": "line", "a": 1, "b": 2}, {"id": 12, "type": "line", "a": 3, "b": 4}]
    session = session_with_path(points, lines)
    with pytest.raises((OperationError, RequestError)):
        session.handle({"type": "tool_commit", "tool": "path_array", "selection": {"rail": 1}, "params": {"count": 3}})


def test_revolve_a_whole_kept_sketch_around_an_axis():
    points = [{"id": 1, "u": 60, "v": 0}, {"id": 2, "u": 70, "v": 0}, {"id": 3, "u": 70, "v": 10}, {"id": 4, "u": 60, "v": 10}]
    lines = [{"id": 10 + i, "type": "line", "a": i + 1, "b": (i + 1) % 4 + 1} for i in range(4)]
    session = session_with_path(points, lines, plane="XZ")
    before = volume(session.document.current.shape)
    names = session.handle({"type": "available_tools", "selection": {"rail": 1, "axes": [2]}})["tools"]
    assert "revolve_face" in names
    assert "revolve_face" not in session.handle({"type": "available_tools", "selection": {"rail": 1}})["tools"]
    session.handle({"type": "tool_commit", "tool": "revolve_face", "selection": {"rail": 1, "axes": [2]}, "params": {"angle": 360}})
    assert volume(session.document.current.shape) > before + 1000  # a ring of the swept rectangle was added

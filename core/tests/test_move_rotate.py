"""Move/Rotate: one tool moves and turns a body (turn about its own center first, then the move)."""

import math

import pytest
from OCP.Bnd import Bnd_Box
from OCP.BRepBndLib import BRepBndLib

from pliable.protocol import decode_binary
from pliable.server import Session
from pliable.tools import Selection, get_tool
from test_features import volume


def _box(shape):
    box = Bnd_Box()
    BRepBndLib.AddOptimal_s(shape, box, False, False)
    lo, hi = box.CornerMin(), box.CornerMax()
    return (lo.X(), lo.Y(), lo.Z()), (hi.X(), hi.Y(), hi.Z())


def _centre_size(shape):
    lo, hi = _box(shape)
    return [(a + b) / 2 for a, b in zip(lo, hi)], [b - a for a, b in zip(lo, hi)]


def _session():
    s = Session()
    s.handle({"type": "open_demo", "name": "block"})
    s.handle({"type": "tool_commit", "tool": "add_box", "params": {"width": 10, "depth": 20, "height": 30, "x": 100, "new_body": 1}})
    return s


def test_one_tool_moves_and_rotates():
    tool = get_tool("move_body")
    assert tool.label == "Move/Rotate"
    assert [p.name for p in tool.params] == ["dx", "dy", "dz", "rx", "ry", "rz"]
    assert not tool.describe()["hidden"]


def test_rotate_then_translate_through_execute():
    s = _session()
    topology = s.document.current
    body = [b.id for b in topology.bodies.bodies][1]
    result = get_tool("move_body").execute(topology, Selection(bodies=[body]), {"rx": 0, "ry": 0, "rz": 90, "dx": 5, "dy": -2, "dz": 7}, preview=False)
    assert volume(result.shape) == pytest.approx(volume(topology.shape))
    # the whole model's box grew to hold the moved body; check the body itself via the second solid
    from pliable.ops import solids_of

    old = _centre_size(solids_of(topology.shape)[1])
    new = _centre_size(solids_of(result.shape)[1])
    assert new[0] == pytest.approx([old[0][0] + 5, old[0][1] - 2, old[0][2] + 7], abs=1e-6)  # center moved by exactly the vector
    assert new[1] == pytest.approx([old[1][1], old[1][0], old[1][2]], abs=1e-6)  # 90 degrees about Z swaps X and Y extents


def test_rotation_is_about_the_body_centre_and_in_x_y_z_order():
    s = _session()
    topology = s.document.current
    from pliable.ops import solids_of

    box = solids_of(topology.shape)[1]
    result = get_tool("move_body").execute(topology, Selection(bodies=[topology.bodies.bodies[1].id]), {"rx": 90, "rz": 90}, preview=False)
    centre0, size0 = _centre_size(box)
    centre1, size1 = _centre_size(solids_of(result.shape)[1])
    assert centre1 == pytest.approx(centre0, abs=1e-6)
    # X by 90 turns (10, 20, 30) into (10, 30, 20); Z by 90 then swaps X and Y: (30, 10, 20)
    assert size1 == pytest.approx([30, 10, 20], abs=1e-6)


def test_session_commit_is_one_undo_step_and_keeps_the_body():
    s = _session()
    volume_before = volume(s.document.current.shape)
    body = s.document.current.bodies.bodies[1].id
    reply = s.handle({"type": "tool_commit", "tool": "move_body", "selection": {"bodies": [body]}, "params": {"rz": 90, "dx": 3}})
    header = decode_binary(reply)[0]
    assert [b["id"] if isinstance(b, dict) else b[0] for b in header["bodies"]][1] == body
    assert volume(s.document.current.shape) == pytest.approx(volume_before)
    s.handle({"type": "undo"})
    from pliable.ops import solids_of

    assert _centre_size(solids_of(s.document.current.shape)[1])[1] == pytest.approx([10, 20, 30], abs=1e-6)


def test_rotation_rings_declare_axis_ring_and_degrees():
    s = _session()
    body = s.document.current.bodies.bodies[1].id
    handles = {h["param"]: h for h in s.handle({"type": "tool_handles", "tool": "move_body", "selection": {"bodies": [body]}, "params": {"rz": 30}})["handles"]}
    ring = handles["rz"]
    cx, cy, cz, radius = ring["ring"]
    assert ring["axis"] == [0.0, 0.0, 1.0] and ring["unit"] == "°"
    assert (cx, cy, cz) == pytest.approx((105, 10, 15))  # the body's center
    x, y, z = (a - c for a, c in zip(ring["anchor"], (cx, cy, cz)))
    assert math.hypot(x, y) == pytest.approx(radius) and z == pytest.approx(0)
    assert math.degrees(math.atan2(y, x)) == pytest.approx(45 + 30)
    assert ring["scale"] == pytest.approx(math.degrees(1 / radius))
    assert ring["direction"][0] * x + ring["direction"][1] * y == pytest.approx(0, abs=1e-9)
    assert handles["dx"]["ring"] is None

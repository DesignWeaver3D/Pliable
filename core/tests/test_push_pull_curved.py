"""Push/pull Up to face with a curved target (cylinder, sphere, cone), through Tool.execute and the server session."""

import math

import pytest
from build123d import Box, Cone, Cylinder, Pos, Rot, Sphere
from OCP.BRepAdaptor import BRepAdaptor_Surface
from OCP.GeomAbs import GeomAbs_Cone, GeomAbs_Cylinder, GeomAbs_Sphere

from pliable.ops import OperationError, solids_of
from pliable.protocol import decode_binary
from pliable.tools import Selection, get_tool
from pliable.topology import Topology

from test_push_pull_upto import find_face, session_with, volume


def pull(session, face, **params):
    return get_tool("push_pull").execute(Topology(session.document.current.shape), Selection(faces=[face]), {"distance": 1, **params}, preview=False)


def reply_commit(session, face, **params):
    reply = session.handle({"type": "tool_commit", "tool": "push_pull", "selection": {"faces": [face]}, "params": {"distance": 3, **params}})
    return decode_binary(reply)[0]


def curved_face(session, kind) -> int:
    return next(i for i, f in session.document.current.faces() if BRepAdaptor_Surface(f).GetType() == kind)


def grid_volume(height, size=10.0, n=200) -> float:
    """The volume under `height(x, y)` over a square of side `size` centered on the origin (midpoint rule)."""
    step = size / n
    return sum(height(-size / 2 + (i + 0.5) * step, -size / 2 + (j + 0.5) * step) for i in range(n) for j in range(n)) * step * step


BLOCK = Box(10, 10, 10)  # z -5 .. 5
BAR = Pos(0, 0, 35) * Rot(90, 0, 0) * Cylinder(15, 60)  # a bar along y whose underside is at z = 20


def test_a_cylinder_target_ends_the_pad_on_its_surface():
    session = session_with(BLOCK, BAR)
    top, wall = find_face(session, 5, 1), curved_face(session, GeomAbs_Cylinder)
    before = volume(session.document.current.shape)
    reply_commit(session, top, target=wall)
    shape = session.document.current.shape
    expected = grid_volume(lambda x, y: 35 - math.sqrt(225 - x * x) - 5)
    assert volume(shape) - before == pytest.approx(expected, rel=2e-3)  # flush: no gap and no overlap
    assert len(solids_of(shape)) == 1  # the pad joins the block and the bar


def test_a_sphere_target_ends_the_pad_on_its_surface():
    session = session_with(BLOCK, Pos(0, 0, 30) * Sphere(15))
    top, ball = find_face(session, 5, 1), curved_face(session, GeomAbs_Sphere)
    before = volume(session.document.current.shape)
    result = pull(session, top, target=ball)
    expected = grid_volume(lambda x, y: 30 - math.sqrt(225 - x * x - y * y) - 5)
    assert volume(result.shape) - before == pytest.approx(expected, rel=2e-3)


def test_a_cone_target_ends_the_pad_on_its_surface():
    ceiling = Pos(0, 0, 25) * Box(40, 40, 10) - Pos(0, 0, 24) * Cone(12, 0, 8)  # a conical hollow, apex up at z = 28
    session = session_with(BLOCK, ceiling)
    top, cone = find_face(session, 5, 1), curved_face(session, GeomAbs_Cone)
    result = pull(session, top, target=cone)
    expected = grid_volume(lambda x, y: 28 - math.hypot(x, y) * 8 / 12 - 5)
    assert volume(result.shape) - volume(session.document.current.shape) == pytest.approx(expected, rel=2e-3)


def test_a_curved_target_covering_only_part_of_the_face_is_refused_and_nothing_changes():
    session = session_with(Box(40, 40, 10), BAR)
    top, wall = find_face(session, 5, 1), curved_face(session, GeomAbs_Cylinder)
    before = volume(session.document.current.shape)
    with pytest.raises(OperationError, match="does not cover"):
        reply_commit(session, top, target=wall)
    assert volume(session.document.current.shape) == before


def test_a_curved_target_behind_the_pull_is_refused():
    session = session_with(BLOCK, Pos(0, 0, -35) * Rot(90, 0, 0) * Cylinder(15, 60))
    top, wall = find_face(session, 5, 1), curved_face(session, GeomAbs_Cylinder)
    with pytest.raises(OperationError, match="does not cover"):
        reply_commit(session, top, target=wall)


def test_a_curved_target_with_new_body_makes_a_separate_pad():
    session = session_with(BLOCK, BAR)
    top, wall = find_face(session, 5, 1), curved_face(session, GeomAbs_Cylinder)
    result = pull(session, top, target=wall, mode="new")
    assert len(solids_of(result.shape)) == 3

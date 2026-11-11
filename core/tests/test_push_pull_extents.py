"""Push/pull Up to last and Through all, through Tool.execute and the server session."""

import math

import pytest
from build123d import Box, Cylinder, Pos

from pliable.ops import OperationError, solids_of
from pliable.tools import Selection, get_tool
from pliable.topology import Topology

from test_push_pull_curved import pull, reply_commit
from test_push_pull_upto import find_face, session_with, volume


LOW = Box(20, 20, 10)  # z -5 .. 5
STEP = Pos(0, 0, 25) * Box(10, 10, 10)  # z 20 .. 30
TIP = Pos(0, 0, 40) * Box(6, 6, 10)  # z 35 .. 45


def test_up_to_last_fills_to_the_last_surface_ray_by_ray():
    session = session_with(LOW, STEP, TIP)
    top = find_face(session, 5, 1)
    before = volume(session.document.current.shape)
    reply_commit(session, top, extent="last")
    # the 10 x 10 middle rises to z 30 and its 6 x 6 core on to z 45, joined to every body
    assert volume(session.document.current.shape) - before == pytest.approx(10 * 10 * 15 + 6 * 6 * 5, rel=1e-6)
    assert len(solids_of(session.document.current.shape)) == 1


def test_up_to_last_leaves_the_hole_in_a_body_open():
    ring = Pos(0, 0, 25) * (Box(10, 10, 10) - Cylinder(2, 10))
    session = session_with(LOW, ring)
    top = find_face(session, 5, 1)
    before = volume(session.document.current.shape)
    reply_commit(session, top, extent="last")
    assert volume(session.document.current.shape) - before == pytest.approx((100 - 4 * math.pi) * 15, rel=1e-6)


def test_through_all_ends_on_a_plane_at_the_farthest_extent():
    session = session_with(LOW, STEP, TIP)
    top = find_face(session, 5, 1)
    before = volume(session.document.current.shape)
    reply_commit(session, top, extent="through")
    assert volume(session.document.current.shape) - before == pytest.approx(400 * 40 - 100 * 10 - 36 * 10, rel=1e-6)  # the whole face up to z 45, less what is already there


def test_nothing_beyond_the_profile_is_an_error_and_the_model_is_unchanged():
    session = session_with(LOW)
    top = find_face(session, 5, 1)
    before = volume(session.document.current.shape)
    for extent in ("last", "through"):
        with pytest.raises(OperationError, match="nothing"):
            reply_commit(session, top, extent=extent)
    assert volume(session.document.current.shape) == before


def test_bodies_off_to_the_side_give_nothing_to_extrude_through():
    session = session_with(LOW, Pos(50, 0, 25) * Box(10, 10, 10))
    top = find_face(session, 5, 1)
    for extent in ("last", "through"):
        with pytest.raises(OperationError, match="nothing"):
            reply_commit(session, top, extent=extent)


def test_new_body_keeps_the_extent_pad_separate():
    session = session_with(LOW, STEP)
    result = pull(session, find_face(session, 5, 1), extent="last", mode="new")
    assert len(solids_of(result.shape)) == 3


def test_symmetric_is_refused_for_the_extents():
    session = session_with(LOW, STEP)
    top = find_face(session, 5, 1)
    for extent in ("last", "through"):
        with pytest.raises(OperationError, match="symmetric"):
            reply_commit(session, top, extent=extent, symmetric=1)


def test_an_unknown_extent_is_refused():
    session = session_with(LOW, STEP)
    with pytest.raises(OperationError, match="extent"):
        reply_commit(session, find_face(session, 5, 1), extent="forever")


def test_the_preview_path_builds_the_same_pad():
    session = session_with(LOW, STEP)
    top = find_face(session, 5, 1)
    result = get_tool("push_pull").execute(Topology(session.document.current.shape), Selection(faces=[top]), {"distance": 1, "extent": "last"}, preview=True)
    assert volume(result.shape) == pytest.approx(volume(session.document.current.shape) + 100 * 15, rel=1e-6)

"""Push/pull Up to face: the target face id as the `target` parameter, through Tool.execute and the server session."""

import math

import pytest
from build123d import Box, Compound, Cylinder, Pos, Rot
from OCP.BRepGProp import BRepGProp
from OCP.GProp import GProp_GProps

from pliable import sketch
from pliable.document import Document
from pliable.ops import OperationError, solids_of
from pliable.protocol import decode_binary
from pliable.server import Session
from pliable.tools import Selection, get_tool
from pliable.topology import Topology


def volume(shape) -> float:
    total = 0.0
    for s in solids_of(shape):
        props = GProp_GProps()
        BRepGProp.VolumeProperties_s(s, props)
        total += props.Mass()
    return total


def session_with(*parts) -> Session:
    session = Session()
    session.document = Document(Compound(list(parts)).wrapped)
    return session


def find_face(session, z=None, normal_z=None, tilted=False) -> int:
    """The face whose plane passes (through the origin column) at height z with the given sign of normal z."""
    for i, face in session.document.current.faces():
        plane = sketch.face_plane(face)
        nz = plane["normal"][2]
        if tilted:
            if 0.5 < abs(nz) < 0.999 and (nz > 0) == (normal_z > 0):
                return i
        elif abs(nz) > 0.999 and (nz > 0) == (normal_z > 0) and abs(plane["origin"][2] - z) < 1e-6:
            return i
    raise AssertionError("no such face")


def commit(session, face, target, interact="others", **params):
    reply = session.handle({"type": "tool_commit", "tool": "push_pull", "interact": interact, "selection": {"faces": [face]}, "params": {"distance": 3, "target": target, **params}})
    return decode_binary(reply)[0]


LOWER = Box(20, 20, 10)  # z -5 .. 5
UPPER = Pos(0, 0, 25) * Box(20, 20, 10)  # z 20 .. 30
LOWER_V, UPPER_V = 20 * 20 * 10, 20 * 20 * 10


def test_a_flat_parallel_target_gives_the_same_pad_as_a_pull_of_that_distance():
    session = session_with(LOWER, UPPER)
    top, target = find_face(session, 5, 1), find_face(session, 20, -1)
    straight = get_tool("push_pull").execute(Topology(session.document.current.shape), Selection(faces=[top]), {"distance": 15}, preview=False)
    commit(session, top, target)  # the typed distance 3 is ignored
    shape = session.document.current.shape
    assert volume(shape) == pytest.approx(volume(straight.shape), rel=1e-6)
    assert volume(shape) == pytest.approx(LOWER_V + UPPER_V + 400 * 15, rel=1e-6)
    assert len(solids_of(shape)) == 1  # the pad joins the two bodies


def test_the_preview_path_ends_on_the_target_too():
    session = session_with(LOWER, UPPER)
    top, target = find_face(session, 5, 1), find_face(session, 20, -1)
    result = get_tool("push_pull").execute(Topology(session.document.current.shape), Selection(faces=[top]), {"distance": -7, "target": target}, preview=True)
    assert volume(result.shape) == pytest.approx(LOWER_V + UPPER_V + 400 * 15, rel=1e-6)


def test_a_tilted_flat_target_clips_the_pad_flush():
    upper = Pos(0, 0, 25) * (Rot(0, 10, 0) * Box(40, 40, 10))  # its underside is tilted 10 degrees, 20 above the origin at x = 0
    session = session_with(LOWER, upper)
    top = find_face(session, 5, 1)
    target = find_face(session, normal_z=-1, tilted=True)
    upper_v = 40 * 40 * 10
    plane = sketch.face_plane(session.document.current.face(target))
    ox, oy, oz = plane["origin"]
    nx, ny, nz = plane["normal"]
    mean = oz - (nx * (0 - ox) + ny * (0 - oy)) / nz - 5  # the pad's height at the middle of the square, which is its mean height
    commit(session, top, target)
    shape = session.document.current.shape
    far = 15 + 10 * math.tan(math.radians(10))
    assert volume(shape) < LOWER_V + upper_v + 400 * far - 1  # less than a straight pull to the farthest point
    assert volume(shape) == pytest.approx(LOWER_V + upper_v + 400 * mean, rel=1e-6)  # no gap and no overlap: the pad ends on the plane
    assert len(solids_of(shape)) == 1


def test_a_target_behind_the_pull_is_refused_and_nothing_changes():
    session = session_with(LOWER, UPPER)
    before = volume(session.document.current.shape)
    top_of_upper, behind = find_face(session, 30, 1), find_face(session, 5, 1)
    with pytest.raises(OperationError, match="behind"):
        commit(session, top_of_upper, behind)
    assert volume(session.document.current.shape) == before


def test_the_target_cannot_be_the_pulled_face():
    session = session_with(LOWER, UPPER)
    top = find_face(session, 5, 1)
    with pytest.raises(OperationError, match="being pulled"):
        commit(session, top, top)


def test_a_target_parallel_to_the_pull_is_refused():
    side = Pos(5, 0, 25) * Box(10, 20, 10)  # its face at x = 0 runs along the pull
    session = session_with(LOWER, side)
    top = find_face(session, 5, 1)
    wall = next(i for i, f in session.document.current.faces() if abs(sketch.face_plane(f)["normal"][0]) > 0.999 and abs(sketch.face_plane(f)["origin"][0]) < 1e-6)
    with pytest.raises(OperationError, match="parallel"):
        commit(session, top, wall)


def test_a_target_the_pull_never_meets_is_refused():
    session = session_with(LOWER, Pos(0, 0, 25) * Cylinder(5, 10))
    top = find_face(session, 5, 1)
    from OCP.BRepAdaptor import BRepAdaptor_Surface
    from OCP.GeomAbs import GeomAbs_Cylinder

    wall = next(i for i, f in session.document.current.faces() if BRepAdaptor_Surface(f).GetType() == GeomAbs_Cylinder)
    with pytest.raises(OperationError, match="does not cover"):
        commit(session, top, wall)


def test_new_body_adds_the_pad_as_its_own_solid():
    session = session_with(LOWER, UPPER)
    top, target = find_face(session, 5, 1), find_face(session, 20, -1)
    commit(session, top, target, mode="new")
    shape = session.document.current.shape
    assert len(solids_of(shape)) == 3
    assert volume(shape) == pytest.approx(LOWER_V + UPPER_V + 400 * 15, rel=1e-6)


def test_symmetric_is_refused():
    session = session_with(LOWER, UPPER)
    top, target = find_face(session, 5, 1), find_face(session, 20, -1)
    with pytest.raises(OperationError, match="symmetric"):
        commit(session, top, target, symmetric=1)

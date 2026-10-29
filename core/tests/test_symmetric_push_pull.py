import pytest
from build123d import Box, Pos, Rectangle
from OCP.Bnd import Bnd_Box
from OCP.BRepBndLib import BRepBndLib

from pliable import sketch
from pliable.document import Document
from pliable.protocol import decode_binary
from pliable.ops import OperationError
from pliable.server import Session


def session_with(shape) -> Session:
    session = Session()
    session.document = Document(shape.wrapped)
    return session


def z_range(session) -> tuple[float, float]:
    box = Bnd_Box()
    BRepBndLib.Add_s(session.document.current.shape, box)
    return round(box.CornerMin().Z(), 3), round(box.CornerMax().Z(), 3)


def z_face(session, z: float, up: bool) -> int:
    for i, face in session.document.current.faces():
        plane = sketch.face_plane(face)
        if abs(plane["normal"][2]) > 0.999 and abs(plane["origin"][2] - z) < 1e-6 and (plane["normal"][2] > 0) == up:
            return i
    raise AssertionError("no such face")


def push(session, faces, distance=2, **params):
    reply = session.handle({"type": "tool_commit", "tool": "push_pull", "selection": {"faces": faces}, "params": {"distance": distance, **params}})
    return decode_binary(reply)[0]


def test_plain_push_pull_is_unchanged():
    session = session_with(Box(10, 10, 10))
    push(session, [z_face(session, 5, True)])
    assert z_range(session) == (-5, 7)


def test_one_face_is_mirrored_about_the_origin_plane():
    session = session_with(Box(10, 10, 10))  # centered on the origin: the XY origin plane is its mid-plane
    push(session, [z_face(session, 5, True)], symmetric=1)
    assert z_range(session) == (-7, 7)


def test_one_face_uses_a_datum_plane_when_the_origin_plane_does_not_fit():
    session = session_with(Pos(0, 0, 5) * Box(10, 10, 10))  # z from 0 to 10
    top = z_face(session, 10, True)
    with pytest.raises(OperationError, match="datum plane"):
        push(session, [top], symmetric=1)
    session.handle({"type": "datum_add", "plane": "XY", "offset": 5})
    push(session, [top], symmetric=1)
    assert z_range(session) == (-2, 12)


def test_two_parallel_faces_move_together_about_their_midplane():
    session = session_with(Pos(0, 0, 5) * Box(10, 10, 10))
    faces = [z_face(session, 10, True), z_face(session, 0, False)]
    push(session, faces, symmetric=1)
    assert z_range(session) == (-2, 12)
    with pytest.raises(OperationError):  # without Shift two opposite faces are refused, as a plain push/pull cannot move both sensibly
        push(session, [z_face(session, 12, True), z_face(session, -2, False)])


def test_a_sketch_face_is_pushed_to_both_sides_of_its_plane():
    # Auto mode: the normal side adds and the opposite side subtracts (nothing to cut in an empty model); mode "add" fills both sides.
    session = Session()
    session.document = Document(Rectangle(10, 10).wrapped)  # a loose face in the XY plane
    face_id = 0
    normal = sketch.face_plane(session.document.current.face(face_id))["normal"]
    push(session, [face_id], distance=3, symmetric=1)
    assert z_range(session) == (0, 3) and abs(normal[2]) > 0.999
    session = Session()
    session.document = Document(Rectangle(10, 10).wrapped)
    push(session, [face_id], distance=3, symmetric=1, mode="add")
    assert z_range(session) == (-3, 3)


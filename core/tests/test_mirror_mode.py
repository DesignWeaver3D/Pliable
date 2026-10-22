import pytest
from build123d import Box
from OCP.Bnd import Bnd_Box
from OCP.BRepBndLib import BRepBndLib

from pliable import sketch
from pliable.autosave import Autosaver
from pliable.document import Document
from pliable.protocol import decode_binary
from pliable.server import RequestError, Session

from test_autosave import die


def session_with(shape, saver=None) -> Session:
    session = Session(saver)
    session.document = Document(shape.wrapped)
    return session


def x_range(session) -> tuple[float, float]:
    box = Bnd_Box()
    BRepBndLib.Add_s(session.document.current.shape, box)
    return round(box.CornerMin().X(), 3), round(box.CornerMax().X(), 3)


def x_face(session, x: float) -> int:
    for i, face in session.document.current.faces():
        plane = sketch.face_plane(face)
        if abs(plane["normal"][0]) > 0.999 and abs(plane["origin"][0] - x) < 1e-6:
            return i
    raise AssertionError("no such face")


def header(reply) -> dict:
    return decode_binary(reply)[0]


def push(session, face, distance):
    return header(session.handle({"type": "tool_commit", "tool": "push_pull", "selection": {"faces": [face]}, "params": {"distance": distance}}))


def test_a_pull_on_one_side_is_repeated_on_the_other():
    session = session_with(Box(10, 10, 10))
    h = header(session.handle({"type": "mirror_set", "plane": "YZ"}))
    assert h["mirror"]["name"] == "YZ origin plane"
    push(session, x_face(session, 5), 2)
    assert x_range(session) == (-7, 7)


def test_a_cut_on_one_side_is_repeated_on_the_other():
    session = session_with(Box(10, 10, 10))
    session.handle({"type": "mirror_set", "plane": "YZ"})
    push(session, x_face(session, -5), -2)
    assert x_range(session) == (-3, 3)


def test_without_mirror_mode_only_one_side_changes_and_turning_it_off_stops_mirroring():
    session = session_with(Box(10, 10, 10))
    push(session, x_face(session, 5), 2)
    assert x_range(session) == (-5, 7)
    session.handle({"type": "mirror_set", "plane": "YZ"})
    assert header(session.handle({"type": "mirror_clear"}))["mirror"] is None
    push(session, x_face(session, 7), 1)
    assert x_range(session) == (-5, 8)


def test_mirror_mode_by_datum_plane_is_undoable_and_saved():
    session = session_with(Box(10, 10, 10))
    session.handle({"type": "datum_add", "plane": "YZ", "name": "Middle"})
    h = header(session.handle({"type": "mirror_set", "datum_id": 1}))
    assert h["mirror"]["name"] == "Middle"
    saved = session.handle({"type": "save_project"})
    other = Session()
    assert header(other.handle({"type": "open_project", "data": saved["data"]}))["mirror"]["name"] == "Middle"
    assert header(session.handle({"type": "undo"}))["mirror"] is None
    assert header(session.handle({"type": "redo"}))["mirror"]["name"] == "Middle"
    with pytest.raises(RequestError):
        session.handle({"type": "mirror_set", "datum_id": 9})


def test_mirror_mode_survives_a_core_restart(tmp_path):
    saver = Autosaver(tmp_path)
    session = session_with(Box(10, 10, 10), saver)
    session.handle({"type": "mirror_set", "plane": "XZ"})
    saver.flush()
    die(saver)
    restarted = Session(Autosaver(tmp_path))
    assert header(restarted.handle({"type": "restore_session"}))["mirror"]["name"] == "XZ origin plane"

import base64

import pytest

from pliable import sketch
from pliable.autosave import Autosaver
from pliable.server import RequestError, Session

from test_autosave import die
from test_sketch_store import header


def block_session(tmp_path=None) -> Session:
    session = Session(Autosaver(tmp_path) if tmp_path else None)
    session.handle({"type": "open_demo", "name": "block"})
    return session


def z_faces(session):
    """Ids and heights of the faces whose normal is vertical."""
    found = []
    for i, face in session.document.current.faces():
        plane = sketch.face_plane(face)
        if abs(plane["normal"][2]) > 0.999:
            found.append((i, plane["origin"][2]))
    return sorted(found, key=lambda f: f[1])


def test_add_on_standard_plane_with_offset_rename_move_delete():
    session = block_session()
    h = header(session.handle({"type": "datum_add", "plane": "XY", "offset": 5}))
    assert h["datums"][0]["name"] == "Plane 1" and h["datums"][0]["plane"]["origin"] == [0, 0, 5]
    h = header(session.handle({"type": "datum_rename", "datum_id": 1, "name": "Mid"}))
    assert h["datums"][0]["name"] == "Mid"
    h = header(session.handle({"type": "datum_move", "datum_id": 1, "distance": 2}))
    assert h["datums"][0]["plane"]["origin"] == [0, 0, 7]
    h = header(session.handle({"type": "datum_delete", "datum_id": 1}))
    assert h["datums"] == []
    with pytest.raises(RequestError):
        session.handle({"type": "datum_delete", "datum_id": 1})
    # every step is undoable, and ids are never reused
    assert header(session.handle({"type": "undo"}))["datums"][0]["plane"]["origin"] == [0, 0, 7]
    assert header(session.handle({"type": "datum_add", "plane": "XZ"}))["datums"][-1]["id"] == 2


def test_plane_from_a_face_and_mid_plane_of_two_faces():
    session = block_session()
    (low, z0), (high, z1) = z_faces(session)[0], z_faces(session)[-1]
    assert z1 > z0
    h = header(session.handle({"type": "datum_add", "face": high, "offset": 3}))
    assert h["datums"][0]["plane"]["origin"][2] == pytest.approx(z1 + 3)
    h = header(session.handle({"type": "datum_add", "midplane": [low, high], "name": "Middle"}))
    middle = h["datums"][1]
    assert middle["name"] == "Middle" and middle["plane"]["origin"][2] == pytest.approx((z0 + z1) / 2)
    side = next(i for i, f in session.document.current.faces() if abs(sketch.face_plane(f)["normal"][2]) < 0.1)
    with pytest.raises(RequestError):
        session.handle({"type": "datum_add", "midplane": [low, side]})


def test_datums_survive_save_load_and_a_core_restart(tmp_path):
    session = block_session(tmp_path)
    session.handle({"type": "datum_add", "plane": "YZ", "offset": 4, "name": "Cut line"})
    saved = session.handle({"type": "save_project"})
    other = Session()
    h = header(other.handle({"type": "open_project", "data": saved["data"]}))
    assert h["datums"] == session.document.datum_list() and h["datums"][0]["name"] == "Cut line"
    assert other.document.new_datum_id() == 2
    session.autosaver.flush()
    die(session.autosaver)
    restarted = Session(Autosaver(tmp_path))
    h = header(restarted.handle({"type": "restore_session"}))
    assert h["datums"] == session.document.datum_list()
    assert header(restarted.handle({"type": "undo"}))["datums"] == []

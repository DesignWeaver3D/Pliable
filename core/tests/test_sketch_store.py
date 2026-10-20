import json

from pliable import sketch
from pliable.autosave import Autosaver
from pliable.protocol import decode_binary
from pliable.server import RequestError, Session

import pytest

from test_autosave import die
from test_sketch import rectangle, sketch_of


def make(session, w=10, plane=None, x0=0.0):
    points, lines = rectangle(w, w, x0=x0)
    return sketch_of(points, lines, plane=plane or session.handle({"type": "sketch_plane", "plane": "XY"})["plane"])


def header(reply) -> dict:
    assert isinstance(reply, bytes)
    return decode_binary(reply)[0]


def faces(session) -> int:
    return len(list(session.document.current.faces()))


def open_session():
    session = Session()
    session.handle({"type": "open_demo", "name": "block"})
    return session


def test_keep_then_get_and_replace():
    session = open_session()
    sk = make(session)
    h = header(session.handle({"type": "sketch_keep", "sketch": sk}))
    assert h["sketches"] == [{"id": 1, "name": "Sketch 1", "rev": 1}] and h["sketchId"] == 1
    got = session.handle({"type": "sketch_get", "id": 1})
    assert got["sketch"] == sk and got["name"] == "Sketch 1" and got["rev"] == 1
    got["sketch"]["points"].clear()  # callers cannot mutate stored state
    assert session.handle({"type": "sketch_get", "id": 1})["sketch"] == sk
    h = header(session.handle({"type": "sketch_keep", "id": 1, "sketch": make(session, 20)}))
    assert h["sketches"] == [{"id": 1, "name": "Sketch 1", "rev": 2}] and h["sketchId"] == 1
    h = header(session.handle({"type": "sketch_keep", "id": 1, "name": "Base", "sketch": sk}))
    assert h["sketches"][0] == {"id": 1, "name": "Base", "rev": 3}
    h = header(session.handle({"type": "sketch_keep", "sketch": sk}))
    assert [s["id"] for s in h["sketches"]] == [1, 2] and h["sketches"][1]["name"] == "Sketch 2"
    with pytest.raises(RequestError):
        session.handle({"type": "sketch_get", "id": 9})
    with pytest.raises(RequestError):
        session.handle({"type": "sketch_keep", "id": 9, "sketch": sk})


def test_keep_with_regions_is_one_undo_step():
    session = open_session()
    session.handle({"type": "open_demo", "name": "block"})
    before = faces(session)
    top = session.handle({"type": "sketch_plane", "plane": "XY"})["plane"]
    sk = make(session, 5, plane={**top, "origin": [0, 0, 100]})
    h = header(session.handle({"type": "sketch_keep", "sketch": sk, "regions": True}))
    assert len(h["sketches"]) == 1
    after = faces(session)
    assert after > before
    h = header(session.handle({"type": "undo"}))
    assert h["sketches"] == [] and faces(session) == before
    h = header(session.handle({"type": "redo"}))
    assert len(h["sketches"]) == 1 and faces(session) == after


def test_keep_without_regions_keeps_shape_and_is_undoable():
    session = open_session()
    before = faces(session)
    session.handle({"type": "sketch_keep", "sketch": make(session)})
    assert faces(session) == before and session.document.can_undo
    assert header(session.handle({"type": "undo"}))["sketches"] == []


def test_delete_and_rename_undo_redo():
    session = open_session()
    session.handle({"type": "sketch_keep", "sketch": make(session)})
    h = header(session.handle({"type": "sketch_rename", "id": 1, "name": "Outline"}))
    assert h["sketches"] == [{"id": 1, "name": "Outline", "rev": 2}]
    assert header(session.handle({"type": "undo"}))["sketches"] == [{"id": 1, "name": "Sketch 1", "rev": 1}]
    assert header(session.handle({"type": "redo"}))["sketches"][0]["name"] == "Outline"
    assert header(session.handle({"type": "sketch_delete", "id": 1}))["sketches"] == []
    assert header(session.handle({"type": "undo"}))["sketches"][0]["id"] == 1
    assert header(session.handle({"type": "redo"}))["sketches"] == []
    # ids are never reused
    assert header(session.handle({"type": "sketch_keep", "sketch": make(session)}))["sketchId"] == 2
    with pytest.raises(RequestError):
        session.handle({"type": "sketch_delete", "id": 1})
    with pytest.raises(RequestError):
        session.handle({"type": "sketch_rename", "id": 2, "name": " "})


def test_other_edits_carry_sketches_forward():
    session = open_session()
    session.handle({"type": "sketch_keep", "sketch": make(session)})
    body = session.document.current.bodies.to_json()
    session.handle({"type": "sketch_regions", "sketch": make(session, 3)})
    assert len(header(session.handle({"type": "undo"}))["sketches"]) == 1
    assert body is not None


def test_sketches_survive_autosave_and_restore(tmp_path):
    first = Session(Autosaver(tmp_path))
    first.handle({"type": "open_demo", "name": "block"})
    sk = make(first)
    first.handle({"type": "sketch_keep", "sketch": sk})
    first.handle({"type": "sketch_keep", "sketch": sk})
    first.handle({"type": "sketch_delete", "id": 2})  # sketch-only change is saved too
    die(first.autosaver)
    second = Session(Autosaver(tmp_path))
    second.handle({"type": "restore_session"})
    h = header(second.handle({"type": "undo"}))
    assert [s["id"] for s in h["sketches"]] == [1, 2]
    assert header(second.handle({"type": "redo"}))["sketches"] == [{"id": 1, "name": "Sketch 1", "rev": 1}]
    assert second.handle({"type": "sketch_get", "id": 1})["sketch"] == sk
    assert header(second.handle({"type": "sketch_keep", "sketch": sk}))["sketchId"] == 3


def test_old_autosave_without_sketch_keys_loads(tmp_path):
    first = Session(Autosaver(tmp_path))
    first.handle({"type": "open_demo", "name": "block"})
    first.handle({"type": "sketch_keep", "sketch": make(first)})
    die(first.autosaver)
    meta_path = next(tmp_path.rglob("session.json"))
    meta = json.loads(meta_path.read_text())
    del meta["sketches"], meta["sketch_next"]
    meta_path.write_text(json.dumps(meta))
    second = Session(Autosaver(tmp_path))
    second.handle({"type": "restore_session"})
    assert header(second.handle({"type": "sketch_keep", "sketch": make(second)}))["sketches"] == [{"id": 1, "name": "Sketch 1", "rev": 1}]


def open_paths(plane):
    points = [{"id": 1, "u": 0, "v": 0}, {"id": 2, "u": 10, "v": 0}, {"id": 3, "u": 10, "v": 10},
              {"id": 4, "u": 10, "v": 5}, {"id": 5, "u": 20, "v": 5}, {"id": 6, "u": 20, "v": 15},
              {"id": 7, "u": 30, "v": 20}, {"id": 8, "u": 40, "v": 10}, {"id": 9, "u": 50, "v": 20}]
    chain = {"plane": plane, "points": points, "constraints": [], "entities": [
        {"id": 101, "type": "line", "a": 1, "b": 2},
        {"id": 102, "type": "arc", "center": 4, "start": 2, "end": 3}]}
    spline = {"plane": plane, "points": points, "constraints": [],
              "entities": [{"id": 103, "type": "spline", "points": [6, 7, 8, 9]}]}
    return chain, spline


@pytest.mark.parametrize("regions", [False, True])
def test_open_path_sketches_are_kept_unchanged(regions, tmp_path):
    session = Session(Autosaver(tmp_path))
    session.handle({"type": "open_demo", "name": "block"})
    before = faces(session)
    plane = session.handle({"type": "sketch_plane", "plane": "XY"})["plane"]
    for n, sk in enumerate(open_paths(plane), start=1):
        h = header(session.handle({"type": "sketch_keep", "sketch": sk, "regions": regions}))
        assert h["sketchId"] == n and len(h["sketches"]) == n
        assert h.get("facesMade") == (0 if regions else None)
        assert faces(session) == before
        assert session.handle({"type": "sketch_get", "id": n})["sketch"] == sk
    header(session.handle({"type": "undo"}))
    assert session.handle({"type": "sketch_get", "id": 1})["sketch"] == open_paths(plane)[0]
    header(session.handle({"type": "redo"}))
    die(session.autosaver)
    second = Session(Autosaver(tmp_path))
    second.handle({"type": "restore_session"})
    assert second.handle({"type": "sketch_get", "id": 2})["sketch"] == open_paths(plane)[1]


def test_closed_sketch_reports_faces_made():
    session = open_session()
    top = session.handle({"type": "sketch_plane", "plane": "XY"})["plane"]
    sk = make(session, 5, plane={**top, "origin": [0, 0, 100]})
    assert header(session.handle({"type": "sketch_keep", "sketch": sk, "regions": True}))["facesMade"] == 1

import base64
import io
import json
import zipfile

import pytest

from pliable import projectfile
from pliable.autosave import Autosaver
from pliable.server import RequestError, Session

from test_autosave import die
from test_sketch_store import header, make


def built_session() -> Session:
    """A model with a renamed body and a kept sketch, through the real server handlers."""
    session = Session()
    session.handle({"type": "open_demo", "name": "block"})
    body = session.document.current.bodies.bodies[0]
    session.handle({"type": "rename_body", "body": body.id, "name": "Base plate"})
    session.handle({"type": "sketch_keep", "sketch": make(session, 7), "name": "Outline"})
    return session


def state_of(session: Session) -> dict:
    document = session.document
    return {
        "bodies": [(b.id, b.name) for b in document.current.bodies.bodies],
        "sketches": document.sketches,
        "faces": len(list(document.current.faces())),
    }


def test_save_then_open_round_trips_bodies_names_and_sketches():
    session = built_session()
    before = state_of(session)
    saved = session.handle({"type": "save_project"})
    other = Session()
    h = header(other.handle({"type": "open_project", "data": saved["data"]}))
    assert h["name"] == saved["name"]
    assert state_of(other) == before
    assert before["bodies"][0][1] == "Base plate" and before["sketches"][0]["name"] == "Outline"
    # sketch ids stay unique after the load
    assert other.document.new_sketch_id() == 2


def test_project_file_is_a_versioned_container():
    session = built_session()
    data = base64.b64decode(session.handle({"type": "save_project"})["data"])
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        assert sorted(z.namelist()) == ["model.brep", "project.json"]
        manifest = json.loads(z.read("project.json"))
    assert manifest["kind"] == "pliable-project" and manifest["format"] == projectfile.FORMAT
    assert {"bodies", "sketches", "sketch_next"} <= set(manifest["objects"])


def test_unknown_object_types_are_kept_when_saved_again():
    session = built_session()
    project = session.document.to_project()
    project.other = {"images": [{"id": 1, "name": "Mid"}]}
    raw = projectfile.pack(project)
    other = Session()
    other.handle({"type": "open_project", "data": base64.b64encode(raw).decode()})
    assert other.document.other_objects == {"images": [{"id": 1, "name": "Mid"}]}
    again = projectfile.unpack(base64.b64decode(other.handle({"type": "save_project"})["data"]))
    assert again.other == {"images": [{"id": 1, "name": "Mid"}]}


def test_bad_or_newer_files_are_refused():
    session = Session()
    for data in (b"not a zip", b"PK\x05\x06" + bytes(18)):
        with pytest.raises(RequestError):
            session.handle({"type": "open_project", "data": base64.b64encode(data).decode()})
    good = built_session().handle({"type": "save_project"})["data"]
    out = io.BytesIO()
    with zipfile.ZipFile(io.BytesIO(base64.b64decode(good))) as z, zipfile.ZipFile(out, "w") as w:
        manifest = json.loads(z.read("project.json"))
        manifest["format"] = projectfile.FORMAT + 1
        w.writestr("project.json", json.dumps(manifest))
        w.writestr("model.brep", z.read("model.brep"))
    with pytest.raises(RequestError, match="newer"):
        session.handle({"type": "open_project", "data": base64.b64encode(out.getvalue()).decode()})


def test_autosave_survives_a_core_restart_with_names_and_sketches(tmp_path):
    saver = Autosaver(tmp_path)
    session = Session(saver)
    session.handle({"type": "open_demo", "name": "block"})
    body = session.document.current.bodies.bodies[0]
    session.handle({"type": "rename_body", "body": body.id, "name": "Base plate"})
    session.handle({"type": "sketch_keep", "sketch": make(session, 7), "name": "Outline"})
    before = state_of(session)
    saver.flush()
    die(saver)  # the core is killed
    restarted = Session(Autosaver(tmp_path))
    assert restarted.unclean
    restarted.handle({"type": "restore_session"})
    assert state_of(restarted) == before
    assert restarted.document.can_undo  # the undo steps came back too


def test_a_refused_project_file_shows_in_the_diagnostics():
    session = Session()
    with pytest.raises(RequestError):
        session.handle({"type": "open_project", "data": base64.b64encode(b"Unknown request type").decode()})
    report = session.handle({"type": "diagnostics"})["report"]
    assert report["lastTool"]["tool"] == "open_project" and not report["lastTool"]["ok"]
    assert "not a Pliable project file" in report["lastTool"]["error"]

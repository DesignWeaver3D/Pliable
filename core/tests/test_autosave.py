import pytest
from OCP.Bnd import Bnd_Box
from OCP.BRepBndLib import BRepBndLib
from build123d import Box

from pliable.autosave import Autosaver
from pliable.document import MAX_HISTORY, Document
from pliable.server import RequestError, Session


def commit_boxes(document: Document, count: int):
    for n in range(count):
        document.commit(Box(10 + n, 10, 10).wrapped)


def test_history_is_capped_and_undo_still_works():
    document = Document(Box(5, 5, 5).wrapped)
    commit_boxes(document, MAX_HISTORY + 20)
    assert len(document.ids) == MAX_HISTORY
    assert document.index == MAX_HISTORY - 1
    steps = 0
    while document.undo():
        steps += 1
    assert steps == MAX_HISTORY - 1


def test_save_restore_round_trip(tmp_path):
    saver = Autosaver(tmp_path)
    document = Document(Box(5, 5, 5).wrapped, "part")
    commit_boxes(document, 3)
    document.undo()
    saver.save(document, fresh=True)
    saver.flush()
    info = saver.available()
    assert info == {"name": "part", "steps": 4, "clean": False}
    restored = Autosaver(tmp_path).restore()
    assert restored.name == "part"
    assert len(restored.ids) == 4 and restored.index == 2 and restored.can_redo
    assert restored.current.shape.IsNull() is False


def test_rotation_removes_files_of_forgotten_states(tmp_path):
    saver = Autosaver(tmp_path)
    document = Document(Box(5, 5, 5).wrapped)
    saver.save(document, fresh=True)
    for _ in range(MAX_HISTORY + 5):
        commit_boxes(document, 1)
        saver.save(document)
    saver.flush()
    files = list((tmp_path / "autosave").glob("state_*.brep"))
    assert len(files) == MAX_HISTORY
    assert not (tmp_path / "autosave" / "state_0.brep").exists()


def test_clean_marker(tmp_path):
    saver = Autosaver(tmp_path)
    saver.save(Document(Box(5, 5, 5).wrapped), fresh=True)
    saver.mark_clean()
    assert Autosaver(tmp_path).available()["clean"] is True
    saver.save(Document(Box(5, 5, 5).wrapped), fresh=True)
    saver.flush()
    assert Autosaver(tmp_path).available()["clean"] is False


def test_fresh_document_overwrites_old_states(tmp_path):
    saver = Autosaver(tmp_path)
    saver.save(Document(Box(5, 5, 5).wrapped, "a"), fresh=True)
    saver.save(Document(Box(20, 20, 20).wrapped, "b"), fresh=True)
    saver.flush()
    restored = Autosaver(tmp_path).restore()
    assert restored.name == "b"
    box = restored.current.shape
    bounds = Bnd_Box()
    BRepBndLib.Add_s(box, bounds)
    assert bounds.CornerMax().X() - bounds.CornerMin().X() == pytest.approx(20, abs=1e-3)


def test_session_offers_restore_after_a_kill(tmp_path):
    first = Session(Autosaver(tmp_path))
    first.handle({"type": "open_demo", "name": "bracket"})
    first.autosaver.flush()  # the process is "killed" here: no mark_clean

    second = Session(Autosaver(tmp_path))
    hello = second.handle({"type": "hello"})
    assert hello["restore"]["name"] == "bracket"
    second.handle({"type": "restore_session"})
    assert second.document.name == "bracket"
    assert "restore" not in second.handle({"type": "hello"})


def test_no_prompt_after_clean_exit(tmp_path):
    first = Session(Autosaver(tmp_path))
    first.handle({"type": "open_demo", "name": "block"})
    first.autosaver.mark_clean()
    assert "restore" not in Session(Autosaver(tmp_path)).handle({"type": "hello"})
    with pytest.raises(RequestError):
        Session().handle({"type": "restore_session"})

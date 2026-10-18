import json
import os
import subprocess
import sys
import textwrap

import pytest
from OCP.Bnd import Bnd_Box
from OCP.BRepBndLib import BRepBndLib
from build123d import Box

from pliable.autosave import Autosaver
from pliable.document import MAX_HISTORY, Document
from pliable.server import RequestError, Session


def die(saver: Autosaver) -> None:
    """Make an instance look killed: its work is flushed, but the heartbeat stops and the lock goes stale."""
    saver.flush()
    saver._stop.set()
    os.utime(saver._lock_path, (1, 1))


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
    assert Autosaver(tmp_path).available() is None  # the writer is still alive
    die(saver)
    info = Autosaver(tmp_path).available()
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
    files = list(saver.folder.glob("state_*.brep"))
    assert len(files) == MAX_HISTORY
    assert not (saver.folder / "state_0.brep").exists()


def test_clean_marker(tmp_path):
    saver = Autosaver(tmp_path)
    saver.save(Document(Box(5, 5, 5).wrapped), fresh=True)
    saver.mark_clean()
    assert Autosaver(tmp_path).available()["clean"] is True
    crashed = Autosaver(tmp_path)
    crashed.save(Document(Box(5, 5, 5).wrapped), fresh=True)
    die(crashed)
    assert Autosaver(tmp_path).available()["clean"] is False  # the newest one wins


def test_fresh_document_overwrites_old_states(tmp_path):
    saver = Autosaver(tmp_path)
    saver.save(Document(Box(5, 5, 5).wrapped, "a"), fresh=True)
    saver.save(Document(Box(20, 20, 20).wrapped, "b"), fresh=True)
    die(saver)
    restored = Autosaver(tmp_path).restore()
    assert restored.name == "b"
    box = restored.current.shape
    bounds = Bnd_Box()
    BRepBndLib.Add_s(box, bounds)
    assert bounds.CornerMax().X() - bounds.CornerMin().X() == pytest.approx(20, abs=1e-3)


def test_session_offers_restore_after_a_kill(tmp_path):
    first = Session(Autosaver(tmp_path))
    first.handle({"type": "open_demo", "name": "bracket"})
    die(first.autosaver)  # the process is "killed" here: no mark_clean

    second = Session(Autosaver(tmp_path))
    hello = second.handle({"type": "hello"})
    assert hello["restore"]["name"] == "bracket"
    second.handle({"type": "restore_session"})
    assert second.document.name == "bracket"
    assert "restore" not in second.handle({"type": "hello"})
    assert "restore" not in Session(Autosaver(tmp_path)).handle({"type": "hello"})  # consumed: offered once


def test_no_prompt_after_clean_exit(tmp_path):
    first = Session(Autosaver(tmp_path))
    first.handle({"type": "open_demo", "name": "block"})
    first.autosaver.mark_clean()
    assert "restore" not in Session(Autosaver(tmp_path)).handle({"type": "hello"})
    with pytest.raises(RequestError):
        Session().handle({"type": "restore_session"})


def make_session(root, name: str, steps: int = 2) -> Autosaver:
    saver = Autosaver(root)
    document = Document(Box(5, 5, 5).wrapped, name)
    commit_boxes(document, steps - 1)
    saver.save(document, fresh=True)
    saver.flush()
    return saver


def snapshot(folder) -> dict:
    return {p.name: (p.stat().st_mtime_ns, p.stat().st_size) for p in folder.iterdir()}


def test_two_live_instances_never_touch_each_other(tmp_path):
    a = make_session(tmp_path, "alpha")
    before_a = snapshot(a.folder)
    b = make_session(tmp_path, "beta", steps=3)
    assert a.folder != b.folder
    assert snapshot(a.folder) == before_a  # b did not touch a
    before_b = snapshot(b.folder)
    document = Document(Box(9, 9, 9).wrapped, "alpha2")
    a.save(document, fresh=True)
    a.flush()
    assert snapshot(b.folder) == before_b  # a did not touch b
    # neither sees the other as restorable, and a third start offers nothing
    assert a.available() is None and b.available() is None
    assert Autosaver(tmp_path).available() is None
    a.mark_clean()  # a clean exit of one leaves the other alone
    assert snapshot(b.folder) == before_b


def test_crashed_instance_is_offered_once_most_recent_first(tmp_path):
    old = make_session(tmp_path, "old")
    die(old)
    os.utime(old._meta_path, (1000, 1000))
    new = make_session(tmp_path, "new")
    die(new)
    live = make_session(tmp_path, "live")
    fresh = Autosaver(tmp_path)
    assert fresh.available()["name"] == "new"  # the live instance's model is never offered
    assert fresh.restore().name == "new"
    assert fresh.available()["name"] == "old"  # "new" was consumed
    assert live.folder.exists() and (live.folder / "session.json").exists()
    assert fresh.restore().name == "old"
    assert Autosaver(tmp_path).available() is None


def test_two_starters_cannot_both_claim_a_session(tmp_path):
    die(make_session(tmp_path, "lost"))
    one, two = Autosaver(tmp_path), Autosaver(tmp_path)
    assert one.available() and two.available()
    results = [one.restore(), two.restore()]
    assert sum(r is not None for r in results) == 1


def test_old_sessions_are_capped_but_live_ones_never_pruned(tmp_path):
    for n in range(4):
        saver = make_session(tmp_path, f"s{n}")
        die(saver)
        os.utime(saver._meta_path, (1000 + n, 1000 + n))
    live = make_session(tmp_path, "live")
    Autosaver(tmp_path, max_old=2).available()
    names = sorted(json.loads((p / "session.json").read_text())["name"] for p in (tmp_path / "autosave").glob("inst_*")
                   if (p / "session.json").exists())
    assert names == ["live", "s2", "s3"]
    assert live.folder.exists()


def test_session_from_a_newer_format_is_never_offered_or_deleted(tmp_path):
    saver = make_session(tmp_path, "future")
    die(saver)
    meta = json.loads(saver._meta_path.read_text())
    assert meta["format"] >= 1
    meta["format"] = 999
    saver._meta_path.write_text(json.dumps(meta))
    other = Autosaver(tmp_path, max_old=0)
    assert other.available() is None
    assert other.restore() is None
    assert saver._meta_path.exists()


def test_session_without_a_format_is_offered(tmp_path):
    saver = make_session(tmp_path, "old release")
    die(saver)
    meta = json.loads(saver._meta_path.read_text())
    del meta["format"]
    saver._meta_path.write_text(json.dumps(meta))
    assert Autosaver(tmp_path).available()["name"] == "old release"


def test_flat_layout_from_an_older_release_is_adopted(tmp_path):
    donor = make_session(tmp_path, "flat")
    die(donor)
    root = tmp_path / "autosave"
    for p in donor.folder.iterdir():
        if p.name != "lock.json":
            os.replace(p, root / p.name)
    assert Autosaver(tmp_path).available()["name"] == "flat"
    assert not (root / "session.json").exists()


def test_killed_process_is_offered_at_once(tmp_path):
    """A real process that dies without cleaning up: its pid is gone, so no waiting for the heartbeat to age."""
    script = textwrap.dedent("""
        import os, sys
        from pathlib import Path
        from build123d import Box
        from pliable.autosave import Autosaver
        from pliable.document import Document
        saver = Autosaver(Path(sys.argv[1]))
        saver.save(Document(Box(5, 5, 5).wrapped, "killed"), fresh=True)
        saver.flush()
        os._exit(1)
    """)
    live = make_session(tmp_path, "survivor")
    result = subprocess.run([sys.executable, "-c", script, str(tmp_path)], timeout=120)
    assert result.returncode == 1
    offer = Autosaver(tmp_path).available()
    assert offer["name"] == "killed"
    assert (live.folder / "session.json").exists()

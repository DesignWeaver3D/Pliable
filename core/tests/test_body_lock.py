"""Locked bodies: toggled through the server, undoable, kept by save/open, not copied by duplicate."""
import pytest

from pliable.protocol import decode_binary
from pliable.server import RequestError, Session


def make() -> Session:
    session = Session()
    session.handle({"type": "open_demo", "name": "block"})
    return session


def locks(header) -> list:
    return [b["locked"] for b in header["bodies"]]


def test_lock_is_undoable_and_validated():
    session = make()
    assert locks(decode_binary(session.handle({"type": "set_body_locked", "body": 1, "locked": True}))[0]) == [True]
    assert locks(decode_binary(session.handle({"type": "undo"}))[0]) == [False]
    assert locks(decode_binary(session.handle({"type": "redo"}))[0]) == [True]
    with pytest.raises(RequestError):
        session.handle({"type": "set_body_locked", "body": 99, "locked": True})


def test_lock_survives_save_open_and_duplicate_is_unlocked():
    session = make()
    session.handle({"type": "set_body_locked", "body": 1, "locked": True})
    twin = decode_binary(session.handle({"type": "duplicate_body", "body": 1}))[0]
    assert locks(twin) == [True, False]
    saved = session.handle({"type": "save_project"})
    header = decode_binary(Session().handle({"type": "open_project", "data": saved["data"]}))[0]
    assert locks(header) == [True, False]


def test_old_body_rows_load_unlocked():
    from pliable.bodies import BodyState
    state = BodyState.from_json({"bodies": [[1, "Box 1", None, None, "steel"]], "next": 2, "counts": {}})
    assert state.bodies[0].locked is False

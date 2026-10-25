"""Per-body material: chosen through the server, undoable, kept by save/open, copied by duplicate, and used for the body's mass."""
import pytest

from pliable.protocol import decode_binary
from pliable.server import RequestError, Session


def make() -> Session:
    session = Session()
    session.handle({"type": "open_demo", "name": "block"})  # 40 x 30 x 20 mm = 24000 mm3
    return session


def materials(header) -> list:
    return [b["material"] for b in header["bodies"]]


def test_material_is_undoable_and_validated():
    session = make()
    header = decode_binary(session.handle({"type": "set_body_material", "body": 1, "material": "steel"}))[0]
    assert materials(header) == ["steel"]
    assert materials(decode_binary(session.handle({"type": "undo"}))[0]) == [None]
    assert materials(decode_binary(session.handle({"type": "redo"}))[0]) == ["steel"]
    assert materials(decode_binary(session.handle({"type": "set_body_material", "body": 1, "material": None}))[0]) == [None]
    with pytest.raises(RequestError):
        session.handle({"type": "set_body_material", "body": 99, "material": "pla"})
    with pytest.raises(RequestError):
        session.handle({"type": "set_body_material", "body": 1, "material": ""})


def test_material_survives_save_open_and_duplicate():
    session = make()
    session.handle({"type": "set_body_material", "body": 1, "material": "copper"})
    twin = decode_binary(session.handle({"type": "duplicate_body", "body": 1}))[0]
    assert materials(twin) == ["copper", "copper"]
    saved = session.handle({"type": "save_project"})
    other = Session()
    header = decode_binary(other.handle({"type": "open_project", "data": saved["data"]}))[0]
    assert materials(header) == ["copper", "copper"]


def test_mass_uses_the_bodys_own_density():
    session = make()
    selection = {"bodies": [1]}
    own = session.handle({"type": "measure", "selection": selection, "density": 1240, "densities": {"1": 7850}})
    assert next(r["value"] for r in own["items"][0]["rows"] if r["label"] == "Mass") == pytest.approx(24 * 7.85)
    other = session.handle({"type": "measure", "selection": selection, "density": 1240, "densities": {"2": 7850}})
    assert next(r["value"] for r in other["items"][0]["rows"] if r["label"] == "Mass") == pytest.approx(24 * 1.24)

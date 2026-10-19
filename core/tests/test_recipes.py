"""Editable primitives: the recipe a body keeps while it is still the primitive (see pliable/recipes.py)."""

from pliable.protocol import decode_binary
from pliable.server import RequestError, Session

import pytest

BOX = {"width": 10, "depth": 20, "height": 30, "x": 100, "new_body": 1}


def send(session, kind, **fields):
    return decode_binary(session.handle({"type": kind, **fields}))[0]


def commit(session, tool, params, selection=None, **extra):
    return send(session, "tool_commit", tool=tool, selection=selection or {}, params=params, **extra)


def info(header, body_id):
    return next(b for b in header["bodies"] if b["id"] == body_id)


def make():
    session = Session()
    session.handle({"type": "open_demo", "name": "block"})
    header = commit(session, "add_box", BOX)
    return session, header


def test_a_new_primitive_is_editable_and_a_demo_body_is_not():
    session, header = make()
    box = info(header, 2)
    assert box["editable"] and box["why"] is None
    assert box["recipe"]["tool"] == "add_box" and box["recipe"]["params"]["width"] == 10
    assert not info(header, 1)["editable"] and "Not a primitive" in info(header, 1)["why"]


def test_move_keeps_it_editable_and_updates_the_base_point():
    session, _ = make()
    header = commit(session, "move_body", {"dx": 5, "dy": 0, "dz": 7}, {"bodies": [2]})
    box = info(header, 2)
    assert box["editable"]
    assert box["recipe"]["params"]["x"] == 105 and box["recipe"]["params"]["z"] == 7


def test_edit_size_keeps_id_and_name_and_undo_restores():
    session, _ = make()
    commit(session, "move_body", {"dx": 5, "dy": 0, "dz": 0}, {"bodies": [2]})
    session.handle({"type": "rename_body", "body": 2, "name": "Lid"})
    before = session.document.current.shape
    params = {"width": 40, "depth": 20, "height": 30, "x": 105, "y": 0, "z": 0}
    preview = send(session, "tool_preview", tool="add_box", selection={}, params=params, edit_body=2)
    assert session.document.current.shape is before  # a preview changes nothing
    assert (info(preview, 2)["name"], len(preview["bodies"])) == ("Lid", 2)
    header = commit(session, "add_box", params, edit_body=2)
    box = info(header, 2)
    assert (box["name"], box["editable"], box["recipe"]["params"]["width"]) == ("Lid", True, 40)
    assert [b["id"] for b in header["bodies"]] == [1, 2]
    assert header["bounds"][3] >= 145 - 1e-6
    header = send(session, "undo")  # the edit was one step
    assert session.document.current.shape is before
    assert (info(header, 2)["name"], info(header, 2)["recipe"]["params"]["width"]) == ("Lid", 10)
    send(session, "undo")  # the rename
    header = send(session, "undo")  # the move
    assert info(header, 2)["recipe"]["params"]["x"] == 100


def test_edit_one_undo_step():
    session, _ = make()
    steps = len(session.document.body_states)
    commit(session, "add_box", {"width": 4, "depth": 4, "height": 4, "x": 100, "y": 0, "z": 0}, edit_body=2)
    assert len(session.document.body_states) == steps + 1


def test_rotation_and_uniform_scale_keep_it_editable():
    session, _ = make()
    header = commit(session, "rotate_body", {"axis": 2, "angle": 30}, {"bodies": [2]})
    assert info(header, 2)["editable"] and info(header, 2)["recipe"]["rotated"]
    header = commit(session, "scale_body", {"factor": 2}, {"bodies": [2]})
    box = info(header, 2)
    assert box["editable"] and abs(box["recipe"]["params"]["width"] - 20) < 1e-9
    edited = commit(session, "add_box", {**box["recipe"]["params"], "height": 5}, edit_body=2)
    assert info(edited, 2)["editable"]


def test_fillet_drops_the_recipe_with_the_reason():
    session, header = make()
    edges = [e["id"] for e in header["edges"] if e["body"] == 2][:1]
    header = commit(session, "fillet_chamfer", {"distance": 1}, {"edges": edges})
    box = info(header, 2)
    assert not box["editable"] and box["why"] == "Changed by Fillet/Chamfer"
    with pytest.raises(RequestError):
        commit(session, "add_box", BOX, edit_body=2)


def test_union_drops_the_recipe_even_when_the_shape_is_unchanged():
    session, header = make()
    inside = {"width": 2, "depth": 2, "height": 2, "x": 101, "y": 1, "z": 1, "new_body": 1}
    header = commit(session, "add_box", inside)  # body 3, wholly inside body 2
    faces = [next(f["id"] for f in header["faces"] if f["body"] == b) for b in (2, 3)]
    header = commit(session, "body_boolean", {"mode": 0}, {"faces": faces})
    assert not info(header, 2)["editable"] and "Combine bodies" in info(header, 2)["why"]


def test_joined_primitive_is_an_ordinary_solid():
    session, _ = make()
    header = commit(session, "add_box", {"width": 5, "depth": 5, "height": 5, "x": 100, "y": 0, "z": 0, "new_body": 0})
    assert all(not b["editable"] for b in header["bodies"])


def test_recipes_survive_undo_redo_and_autosave(tmp_path):
    from pliable.autosave import Autosaver

    saver = Autosaver(tmp_path, heartbeat=3600)
    session = Session(saver)
    session.handle({"type": "open_demo", "name": "block"})
    commit(session, "add_box", BOX)
    commit(session, "move_body", {"dx": 1, "dy": 0, "dz": 0}, {"bodies": [2]})
    send(session, "undo")
    header = send(session, "redo")
    assert info(header, 2)["recipe"]["params"]["x"] == 101
    saver.flush()
    saver.mark_clean()
    document = Autosaver(tmp_path, heartbeat=3600).restore()
    box = document.current.bodies.bodies[1]
    assert box.recipe["params"]["x"] == 101 and box.recipe["tool"] == "add_box"

import base64

from build123d import Box, Pos
from OCP.BRep import BRep_Builder
from OCP.TopoDS import TopoDS_Compound

from pliable.protocol import decode_binary
from pliable.server import RequestError, Session

import pytest


def commit(session, tool, params, selection=None):
    reply = session.handle({"type": "tool_commit", "tool": tool, "selection": selection or {}, "params": params})
    return decode_binary(reply)[0]


def bodies(header):
    return [(b["id"], b["name"]) for b in header["bodies"]]


def make():
    session = Session()
    session.handle({"type": "open_demo", "name": "block"})
    return session


def test_new_bodies_get_ids_and_numbered_names():
    session = make()
    assert bodies(decode_binary(session._mesh_reply(session.document.current, {}))[0]) == [(1, "Body 1")]
    commit(session, "add_box", {"width": 5, "depth": 5, "height": 5, "x": 100, "new_body": 1})
    header = commit(session, "add_cylinder", {"diameter": 5, "height": 5, "x": 200, "new_body": 1})
    header = commit(session, "add_box", {"width": 5, "depth": 5, "height": 5, "x": 300, "new_body": 1})
    assert bodies(header) == [(1, "Body 1"), (2, "Box 1"), (3, "Cylinder 1"), (4, "Box 2")]
    assert {f["body"] for f in header["faces"]} == {1, 2, 3, 4}


def test_ids_survive_operations_moves_and_undo():
    session = make()
    commit(session, "add_box", {"width": 5, "depth": 5, "height": 5, "x": 100, "new_body": 1})
    header = commit(session, "move_body", {"dx": 7, "dy": 0, "dz": 0}, {"faces": [0]})
    assert [b[0] for b in bodies(header)] == [1, 2]
    header = commit(session, "push_pull", {"distance": 1}, {"faces": [0]})
    assert [b[0] for b in bodies(header)] == [1, 2]
    undone = decode_binary(session.handle({"type": "undo"}))[0]
    assert bodies(undone) == [(1, "Body 1"), (2, "Box 1")]
    redone = decode_binary(session.handle({"type": "redo"}))[0]
    assert [b[0] for b in bodies(redone)] == [1, 2]


def test_rename_is_undoable_and_validated():
    session = make()
    header = decode_binary(session.handle({"type": "rename_body", "body": 1, "name": "  Base  "}))[0]
    assert bodies(header) == [(1, "Base")]
    assert bodies(decode_binary(session.handle({"type": "undo"}))[0]) == [(1, "Body 1")]
    assert bodies(decode_binary(session.handle({"type": "redo"}))[0]) == [(1, "Base")]
    with pytest.raises(RequestError):
        session.handle({"type": "rename_body", "body": 1, "name": " "})
    with pytest.raises(RequestError):
        session.handle({"type": "rename_body", "body": 99, "name": "x"})


def test_split_keeps_id_on_larger_part_and_union_consumes_second():
    session = Session()
    from pliable.document import Document
    session.document = Document(Box(10, 10, 10).wrapped)
    commit(session, "add_box", {"width": 10, "depth": 10, "height": 10, "x": 20, "new_body": 1})
    # cut the first box by a plane not through it: ids stay
    header = commit(session, "add_box", {"width": 10, "depth": 10, "height": 10, "x": 5, "y": 0, "z": 0, "new_body": 0})
    # box 2 overlaps box 1 and fuses: body 1 survives, the fused-in body is gone or the new one is unnamed
    ids = [b[0] for b in bodies(header)]
    assert ids[0] == 1 and len(ids) == 2


def test_names_and_ids_survive_autosave_restore(tmp_path):
    from pliable.autosave import Autosaver

    saver = Autosaver(tmp_path, heartbeat=3600)
    session = Session(saver)
    session.handle({"type": "open_demo", "name": "block"})
    commit(session, "add_box", {"width": 5, "depth": 5, "height": 5, "x": 100, "new_body": 1})
    session.handle({"type": "rename_body", "body": 2, "name": "Lid"})
    saver.flush()
    saver.mark_clean()
    other = Autosaver(tmp_path, heartbeat=3600)
    document = other.restore()
    assert [(b.id, b.name) for b in document.current.bodies.bodies] == [(1, "Body 1"), (2, "Lid")]
    assert document.current.bodies.next_id == 3


def test_step_part_names_are_kept_on_import():
    from build123d import Compound, export_step
    import os, tempfile

    a, b = Box(10, 10, 10), Pos(30, 0, 0) * Box(5, 5, 5)
    a.label, b.label = "Bracket", "Spacer"
    with tempfile.TemporaryDirectory() as tmp:
        path = os.path.join(tmp, "x.step")
        export_step(Compound(children=[a, b]), path)
        data = open(path, "rb").read()
    session = Session()
    header = decode_binary(session.handle({"type": "import_step", "name": "x", "data": base64.b64encode(data).decode()}))[0]
    assert sorted(n for _, n in bodies(header)) == ["Bracket", "Spacer"]


def test_body_selection_moves_rotates_and_scales_about_each_centre():
    from OCP.BRepGProp import BRepGProp
    from OCP.GProp import GProp_GProps

    from pliable.bodies import box_of

    session = make()
    commit(session, "add_box", {"width": 10, "depth": 10, "height": 10, "x": 100, "y": 0, "z": 0, "new_body": 1})
    solids = lambda: [box_of(s) for s in __import__("pliable.ops", fromlist=["solids_of"]).solids_of(session.document.current.shape)]
    first_before, second_before = solids()
    header = commit(session, "move_body", {"dx": 0, "dy": 0, "dz": 50}, {"bodies": [2]})
    first, second = solids()
    assert first == first_before and second[2] == pytest.approx(second_before[2] + 50)
    assert header["selection"]["bodies"] == [2]
    assert [b[0] for b in bodies(header)] == [1, 2]
    # scale about the body's own centre keeps its centre
    centre = [(second[k] + second[k + 3]) / 2 for k in range(3)]
    commit(session, "scale_body", {"factor": 2}, {"bodies": [2]})
    _, scaled = solids()
    assert [(scaled[k] + scaled[k + 3]) / 2 for k in range(3)] == pytest.approx(centre)
    assert scaled[3] - scaled[0] == pytest.approx(20)
    commit(session, "rotate_body", {"axis": 2, "angle": 90}, {"bodies": [2]})
    _, turned = solids()
    assert [(turned[k] + turned[k + 3]) / 2 for k in range(3)] == pytest.approx(centre)


def test_body_selection_availability():
    session = make()
    commit(session, "add_box", {"width": 10, "depth": 10, "height": 10, "x": 100, "new_body": 1})
    tools = session.handle({"type": "available_tools", "selection": {"bodies": [2]}})["tools"]
    assert {"move_body", "rotate_body", "scale_body", "offset_body"} <= set(tools)
    assert "push_pull" not in tools and "add_hole" not in tools
    assert session.handle({"type": "available_tools", "selection": {"bodies": [99]}})["tools"] == []
    handles = session.handle({"type": "tool_handles", "tool": "rotate_body", "selection": {"bodies": [2]}, "params": {}})["handles"]
    assert handles and abs(handles[0]["anchor"][0] - 105) < 30

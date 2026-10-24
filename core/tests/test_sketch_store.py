import json

from pliable import sketch
from pliable.autosave import Autosaver, _write_brep
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
    got = session.handle({"type": "sketch_get", "sketch_id": 1})
    assert got["sketch"] == sk and got["name"] == "Sketch 1" and got["rev"] == 1
    got["sketch"]["points"].clear()  # callers cannot mutate stored state
    assert session.handle({"type": "sketch_get", "sketch_id": 1})["sketch"] == sk
    h = header(session.handle({"type": "sketch_keep", "sketch_id": 1, "sketch": make(session, 20)}))
    assert h["sketches"] == [{"id": 1, "name": "Sketch 1", "rev": 2}] and h["sketchId"] == 1
    h = header(session.handle({"type": "sketch_keep", "sketch_id": 1, "name": "Base", "sketch": sk}))
    assert h["sketches"][0] == {"id": 1, "name": "Base", "rev": 3}
    h = header(session.handle({"type": "sketch_keep", "sketch": sk}))
    assert [s["id"] for s in h["sketches"]] == [1, 2] and h["sketches"][1]["name"] == "Sketch 2"
    with pytest.raises(RequestError):
        session.handle({"type": "sketch_get", "sketch_id": 9})
    with pytest.raises(RequestError):
        session.handle({"type": "sketch_keep", "sketch_id": 9, "sketch": sk})


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
    h = header(session.handle({"type": "sketch_rename", "sketch_id": 1, "name": "Outline"}))
    assert h["sketches"] == [{"id": 1, "name": "Outline", "rev": 2}]
    assert header(session.handle({"type": "undo"}))["sketches"] == [{"id": 1, "name": "Sketch 1", "rev": 1}]
    assert header(session.handle({"type": "redo"}))["sketches"][0]["name"] == "Outline"
    assert header(session.handle({"type": "sketch_delete", "sketch_id": 1}))["sketches"] == []
    assert header(session.handle({"type": "undo"}))["sketches"][0]["id"] == 1
    assert header(session.handle({"type": "redo"}))["sketches"] == []
    # ids are never reused
    assert header(session.handle({"type": "sketch_keep", "sketch": make(session)}))["sketchId"] == 2
    with pytest.raises(RequestError):
        session.handle({"type": "sketch_delete", "sketch_id": 1})
    with pytest.raises(RequestError):
        session.handle({"type": "sketch_rename", "sketch_id": 2, "name": " "})


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
    first.handle({"type": "sketch_delete", "sketch_id": 2})  # sketch-only change is saved too
    die(first.autosaver)
    second = Session(Autosaver(tmp_path))
    second.handle({"type": "restore_session"})
    h = header(second.handle({"type": "undo"}))
    assert [s["id"] for s in h["sketches"]] == [1, 2]
    assert header(second.handle({"type": "redo"}))["sketches"] == [{"id": 1, "name": "Sketch 1", "rev": 1}]
    assert second.handle({"type": "sketch_get", "sketch_id": 1})["sketch"] == sk
    assert header(second.handle({"type": "sketch_keep", "sketch": sk}))["sketchId"] == 3


def test_old_autosave_without_sketch_keys_loads(tmp_path):
    first = Session(Autosaver(tmp_path))
    first.handle({"type": "open_demo", "name": "block"})
    first.handle({"type": "sketch_keep", "sketch": make(first)})
    die(first.autosaver)
    # rewrite the session the way the first autosave format did: bare BREP files, no sketch keys
    meta_path = next(tmp_path.rglob("session.json"))
    meta = json.loads(meta_path.read_text())
    document = first.document
    for state_id in meta["ids"]:
        _write_brep(document.shape_of(state_id), meta_path.parent / f"state_{state_id}.brep")
        (meta_path.parent / f"state_{state_id}.plbl").unlink()
    meta["format"] = 1
    meta["bodies"] = [b.to_json() for b in document.body_states]
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
        assert session.handle({"type": "sketch_get", "sketch_id": n})["sketch"] == sk
    header(session.handle({"type": "undo"}))
    assert session.handle({"type": "sketch_get", "sketch_id": 1})["sketch"] == open_paths(plane)[0]
    header(session.handle({"type": "redo"}))
    die(session.autosaver)
    second = Session(Autosaver(tmp_path))
    second.handle({"type": "restore_session"})
    assert second.handle({"type": "sketch_get", "sketch_id": 2})["sketch"] == open_paths(plane)[1]


def test_closed_sketch_reports_faces_made():
    session = open_session()
    top = session.handle({"type": "sketch_plane", "plane": "XY"})["plane"]
    sk = make(session, 5, plane={**top, "origin": [0, 0, 100]})
    assert header(session.handle({"type": "sketch_keep", "sketch": sk, "regions": True}))["facesMade"] == 1


def test_the_wire_correlation_id_is_not_mistaken_for_a_sketch_id():
    # over the socket every request carries its own "id"; the sketch's id travels as "sketch_id"
    session = Session()
    session.handle({"type": "open_demo", "name": "block"})
    sk = make(session)
    h = header(session.handle({"id": 99, "type": "sketch_keep", "sketch": sk}))
    assert h["sketches"] == [{"id": 1, "name": "Sketch 1", "rev": 1}]
    got = session.handle({"id": 100, "type": "sketch_get", "sketch_id": 1})
    assert got["sketch_id"] == 1 and "id" not in got


def test_profiles_are_view_only_meshes_and_keeping_makes_no_model_faces():
    session = open_session()
    sk = make(session, 10)
    before = faces(session)
    keep = session.handle({"type": "sketch_keep", "sketch": sk, "regions": False})
    assert header(keep)["sketches"][0]["id"] == 1 and faces(session) == before  # nothing is added to the model
    for request in ({"type": "sketch_profiles", "sketch_id": 1}, {"type": "sketch_profiles", "sketch": sk}):
        profiles = session.handle(request)["profiles"]
        assert len(profiles) == 1
        p, tri = profiles[0]["positions"], profiles[0]["indices"]
        area = 0.0
        for k in range(0, len(tri), 3):
            a, b, c = ([p[3 * i + j] for j in range(3)] for i in tri[k : k + 3])
            u = [b[j] - a[j] for j in range(3)]
            v = [c[j] - a[j] for j in range(3)]
            cross = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]
            area += 0.5 * sum(x * x for x in cross) ** 0.5
        assert area == pytest.approx(100, rel=1e-6)
    assert faces(session) == before


def test_extrude_a_stored_sketch_by_id_and_keep_in_the_same_step():
    session = open_session()
    sk = make(session, 10)
    session.handle({"type": "sketch_keep", "sketch": sk})
    reply = session.handle({"type": "sketch_extrude", "sketch_id": 1, "distance": 5, "mode": "new", "commit": True})
    assert header(reply)["sketches"] == [{"id": 1, "name": "Sketch 1", "rev": 1}]
    assert session.document.can_undo
    session.handle({"type": "undo"})
    second = make(session, 20)
    header_after = header(session.handle({"type": "sketch_extrude", "sketch": second, "distance": 5, "mode": "new", "commit": True, "keep": True}))
    assert [s["id"] for s in header_after["sketches"]] == [1, 2] and header_after["sketchId"] == 2
    undone = header(session.handle({"type": "undo"}))
    assert [s["id"] for s in undone["sketches"]] == [1]  # the extrusion and the kept sketch went together


def test_picking_one_region_adds_its_face_and_selects_it():
    session = open_session()
    sk = make(session, 10)
    session.handle({"type": "sketch_keep", "sketch": sk, "regions": False})
    before = faces(session)
    h = header(session.handle({"type": "sketch_regions", "sketch_id": 1, "region": 0}))
    assert faces(session) == before + 1
    selected = h["selection"]["faces"]
    assert len(selected) == 1
    assert sketch.Face(session.document.current.face(selected[0])).area == pytest.approx(100, rel=1e-6)
    session.handle({"type": "undo"})
    assert faces(session) == before
    with pytest.raises(RequestError):
        session.handle({"type": "sketch_regions", "sketch_id": 1, "region": 5})


def test_every_region_stays_pickable_after_a_neighbour_is_extruded_or_its_body_deleted():
    from test_sketch import _free_line

    session = open_session()
    plane = session.handle({"type": "sketch_plane", "plane": "XY"})["plane"]
    points, lines = rectangle(20, 20, x0=30)
    _free_line(lines, points, (30, 8), (50, 8), 50)
    header(session.handle({"type": "sketch_keep", "sketch": sketch_of(points, lines, plane=plane)}))

    def pick(region):
        return header(session.handle({"type": "sketch_regions", "sketch_id": 1, "region": region}))["selection"]["faces"]

    (face,) = pick(0)
    extruded = decode_binary(session.handle({"type": "tool_commit", "tool": "push_pull", "selection": {"faces": [face]}, "params": {"distance": 5}}))[0]
    assert len(pick(1)) == 1  # the neighbour of the extruded region
    session.handle({"type": "undo"})
    body = max(b["id"] for b in extruded["bodies"])
    deleted = decode_binary(session.handle({"type": "delete_body", "body": body}))[0]
    assert body not in [b["id"] for b in deleted["bodies"]]
    assert len(pick(0)) == 1 and len(pick(1)) == 1


def test_extruding_a_picked_region_is_one_undo_step():
    session = open_session()
    session.handle({"type": "sketch_keep", "sketch": make(session, 10), "regions": False})
    before = faces(session)
    picked = header(session.handle({"type": "sketch_regions", "sketch_id": 1, "region": 0}))["selection"]["faces"]
    pull = {"type": "tool_commit", "tool": "push_pull", "selection": {"faces": picked}, "params": {"distance": 5}, "foldPick": True}
    after = header(session.handle(pull))
    pulled = faces(session)
    assert after["canUndo"] and len(session.document.ids) == 3  # open, keep, pull
    undone = header(session.handle({"type": "undo"}))
    assert faces(session) == before and undone["canRedo"]
    session.handle({"type": "redo"})
    assert faces(session) == pulled

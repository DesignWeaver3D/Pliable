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


# ---- enforcement through Tool.execute ----

from pliable.demos import load_demo  # noqa: E402
from pliable.document import Document  # noqa: E402
from pliable.ops import OperationError, planar_normal, solids_of  # noqa: E402
from pliable.tools import Selection, get_tool  # noqa: E402

LOCKED = "This body is locked"


def top_face(topology, body_index):
    from OCP.TopAbs import TopAbs_FACE
    from OCP.TopExp import TopExp
    from OCP.collections import IndexedMap_TopoDS_Shape_TopTools_ShapeMapHasher as ShapeIndexedMap

    mine = ShapeIndexedMap()
    TopExp.MapShapes_s(solids_of(topology.shape)[body_index], TopAbs_FACE, mine)
    best = None
    for i, face in topology.faces():
        normal = planar_normal(face)
        if mine.Contains(face) and normal is not None and normal.Z() > 0.9:
            best = i
    return best


@pytest.fixture
def pair():
    """Two separate blocks: body 1 (locked) and body 2 (not), 100 apart."""
    document = Document(load_demo("block"))
    document.duplicate_body(1)
    moved = get_tool("move_body").execute(document.current, Selection(bodies=[2]), {"dx": 100}, preview=False)
    document.commit(moved.shape, ordered=True)
    document.set_body_locked(1, True)
    return document.current


def run(tool, topology, selection=None, **params):
    return get_tool(tool).execute(topology, selection or Selection(), params, preview=False)


def untouched(topology, result):
    """Whether the locked first solid came through the operation as the very same shape."""
    return solids_of(topology.shape)[0].IsSame(solids_of(result.shape)[0])


@pytest.mark.parametrize("tool,params", [("shell", {"thickness": 2}), ("push_pull", {"distance": 5}), ("draft", {"angle": 3})])
def test_face_tools_refuse_a_locked_face(pair, tool, params):
    with pytest.raises(OperationError, match=LOCKED):
        run(tool, pair, Selection(faces=[top_face(pair, 0)]), **params)


@pytest.mark.parametrize("tool,params", [("move_body", {"dx": 5}), ("scale_body", {"factor": 2}), ("offset_body", {"distance": 1}), ("unify", {})])
def test_body_tools_refuse_a_locked_body(pair, tool, params):
    with pytest.raises(OperationError, match=LOCKED):
        run(tool, pair, Selection(bodies=[1]), **params)


def test_boolean_refuses_a_locked_body(pair):
    with pytest.raises(OperationError, match=LOCKED):
        run("body_boolean", pair, Selection(bodies=[1, 2]), mode=0)


def test_a_tool_on_the_unlocked_body_leaves_the_locked_one_identical(pair):
    result = run("shell", pair, Selection(faces=[top_face(pair, 1)]), thickness=2)
    assert untouched(pair, result)
    assert len(solids_of(result.shape)) == 2


@pytest.mark.parametrize("tool,params", [
    ("move_body", {"dx": 5}), ("scale_body", {"factor": 2}), ("offset_body", {"distance": 1}), ("unify", {}),
    ("cut_plane", {"axis": 2, "position": 10, "remove_side": 1}),
    ("linear_array", {"count": 2, "dx": 200}),
    ("mirror", {"plane": 3, "offset": 40}),
])
def test_whole_model_defaults_skip_the_locked_body(pair, tool, params):
    result = run(tool, pair, **params)
    solids = solids_of(result.shape)
    assert untouched(pair, result)
    assert solids[0].IsSame(solids_of(pair.shape)[0]) and len(solids) >= 2


def test_move_with_nothing_selected_moves_only_the_unlocked_body(pair):
    from pliable.bodies import box_of

    result = run("move_body", pair, dx=5)
    before, after = solids_of(pair.shape)[1], solids_of(result.shape)[1]
    assert box_of(after)[0] == pytest.approx(box_of(before)[0] + 5)


def test_mirror_copy_is_not_fused_into_the_locked_body():
    from pliable.volume import volume_of

    document = Document(load_demo("block"))
    document.set_body_locked(1, True)
    document.duplicate_body(1)  # body 2 is an unlocked copy lying on the locked block
    from pliable.bodies import box_of

    side = box_of(solids_of(document.current.shape)[0])[3]
    result = run("mirror", document.current, plane=3, offset=side)  # across the block's side: the copy would touch both
    solids = solids_of(result.shape)
    assert untouched(document.current, result)
    assert abs(volume_of(solids[0])) == pytest.approx(24000)  # the locked block did not grow
    assert abs(volume_of(solids[1])) == pytest.approx(48000)  # the unlocked one took the copy


def test_everything_locked_refuses_the_whole_model_default(pair):
    state = Document(load_demo("block"))
    state.set_body_locked(1, True)
    for tool, params in (("move_body", {"dx": 5}), ("cut_plane", {"axis": 2, "position": 10}), ("linear_array", {"count": 2, "dx": 100})):
        with pytest.raises(OperationError, match=LOCKED):
            run(tool, state.current, **params)


def test_a_locked_face_can_be_the_mirror_plane(pair):
    result = run("mirror", pair, Selection(faces=[top_face(pair, 0)], bodies=[2]), plane=0)
    assert untouched(pair, result)
    assert len(solids_of(result.shape)) == 2


def test_the_second_face_of_align_face_may_be_locked(pair):
    # Align face moves the first face; the second only gives the plane
    other = top_face(pair, 1)
    result = run("align_face", pair, Selection(faces=[other, top_face(pair, 0)]), offset=5)
    assert untouched(pair, result)
    with pytest.raises(OperationError, match=LOCKED):
        run("align_face", pair, Selection(faces=[top_face(pair, 0), other]), offset=5)


def test_body_list_delete_refuses_a_locked_body_and_edit_stays_allowed():
    from pliable.server import RequestError

    session = make()
    session.handle({"type": "set_body_locked", "body": 1, "locked": True})
    with pytest.raises(RequestError, match=LOCKED):
        session.handle({"type": "delete_body", "body": 1})
    with pytest.raises(RequestError, match=LOCKED):
        session.handle({"type": "delete_body", "bodies": [1]})
    session.handle({"type": "rename_body", "body": 1, "name": "Reference"})
    session.handle({"type": "duplicate_body", "body": 1})

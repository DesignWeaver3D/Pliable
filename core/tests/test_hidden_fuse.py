"""Hidden bodies are skipped when Mirror, arrays and joined primitives fuse their result into the scene."""
import pytest

from pliable.bodies import box_of
from pliable.document import Document
from pliable.ops import solids_of
from pliable.tools import Selection, get_tool
from pliable.volume import volume_of

from pliable.demos import load_demo


@pytest.fixture
def scene():
    """A block with an identical copy lying on it; the copy (body 2) is hidden."""
    document = Document(load_demo("block"))
    document.duplicate_body(document.current.bodies.bodies[0].id)
    topology = document.current
    topology.hidden_bodies = frozenset({topology.bodies.bodies[1].id})
    return topology


def run(tool_id, topology, selection=None, **values):
    tool = get_tool(tool_id)
    given = {p.name: p.default for p in tool.params} | values
    return tool.execute(topology, selection or Selection(), given, preview=False)


def volumes(result):
    return [round(abs(volume_of(s))) for s in solids_of(result.shape)]


def test_mirror_copy_is_not_fused_into_a_hidden_body(scene):
    side = box_of(solids_of(scene.shape)[0])[3]
    assert volumes(run("mirror", scene, plane=3, offset=side)) == [48000, 24000]


def test_array_copies_are_not_fused_into_a_hidden_body(scene):
    width = box_of(solids_of(scene.shape)[0])[3] - box_of(solids_of(scene.shape)[0])[0]
    result = run("linear_array", scene, count=2, rows=1, dx=width)
    assert volumes(result) == [48000, 24000]


def test_joined_primitive_is_not_fused_into_a_hidden_body(scene):
    lo = box_of(solids_of(scene.shape)[0])
    result = run("add_box", scene, new_body=0, x=lo[0], y=lo[1], z=lo[2], width=10, depth=10, height=60)
    out = volumes(result)
    assert len(out) == 2 and out[1] == 24000 and out[0] >= 24000


def test_this_body_setting_keeps_the_copy_out_of_other_visible_bodies(scene):
    scene.hidden_bodies = frozenset()
    scene.interact = "this"
    side = box_of(solids_of(scene.shape)[0])[3]
    selection = Selection(bodies=[scene.bodies.bodies[0].id])
    assert volumes(run("mirror", scene, selection, plane=3, offset=side)) == [48000, 24000]



def test_move_turns_about_the_middle_of_the_unlocked_bodies():
    document = Document(load_demo("block"))
    document.duplicate_body(1)
    moved = run("move_body", document.current, Selection(bodies=[2]), dx=100)
    document.commit(moved.shape, ordered=True)
    document.set_body_locked(1, True)
    topology = document.current
    before = box_of(solids_of(topology.shape)[1])
    after = box_of(solids_of(run("move_body", topology, rz=90).shape)[1])
    for k in range(3):
        assert (after[k] + after[k + 3]) / 2 == pytest.approx((before[k] + before[k + 3]) / 2)

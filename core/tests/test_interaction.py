"""The body interaction setting ("this" / "others"): request field, reply field, defaults and the effect on tools (interaction.py)."""

import dataclasses

import pytest
from build123d import Box, Pos
from OCP.Bnd import Bnd_Box
from OCP.BRepBndLib import BRepBndLib
from OCP.TopoDS import TopoDS

from pliable.body_scope import _compound
from pliable.bodies import BodyState
from pliable.demos import load_demo
from pliable.document import Document
from pliable.ops import OperationError, _faces_of, planar_normal, solids_of
from pliable.protocol import decode_binary
from pliable.server import Session
from pliable.tools import TOOLS, Selection, get_tool
from pliable.topology import Topology
from pliable.volume import volume_of

from test_body_scope import _region_above_block, _with_copy_of, top_face_of


def two_blocks(gap_top=40, locked=False):
    """A 40 x 30 x 20 block with a second one centered `gap_top` above it (a neighbor lying ahead of a pull)."""
    scene = Topology(_compound([Box(40, 30, 20).wrapped, (Pos(0, 0, gap_top) * Box(40, 30, 20)).wrapped]))
    if locked:
        scene.bodies = BodyState(tuple(dataclasses.replace(b, locked=i == 1) for i, b in enumerate(scene.bodies.bodies)), scene.bodies.next_id, scene.bodies.counts)
    return scene


def pull(scene, interact=None, **params):
    scene.interact = interact
    return get_tool("push_pull").execute(scene, Selection(faces=[top_face_of(scene, 0)]), {"distance": 5, **params}, preview=False)


def session_with(scene):
    session = Session()
    session.document = Document(scene.shape)
    return session


def header(reply):
    return decode_binary(reply)[0]


def bottom_face_id(scene, body_index):
    """Scene id of the lowest flat face of one body."""
    solid = solids_of(scene.shape)[body_index]
    lows = []
    for face in map(TopoDS.Face, _faces_of(solid)):
        box = Bnd_Box()
        BRepBndLib.Add_s(face, box)
        normal = planar_normal(face)
        if normal is not None and abs(normal.Z()) > 0.9:
            lows.append((box.CornerMin().Z(), face))
    low = min(lows, key=lambda t: t[0])[1]
    return next(i for i, f in scene.faces() if f.IsSame(low))


def test_the_tool_list_carries_each_tools_default():
    listed = {t["id"]: t["interaction"] for t in Session().handle({"type": "list_tools"})["tools"]}
    for tool_id in ("push_pull", "push_pull_surface", "add_hole", "add_counterbore", "add_countersink", "add_boss", "add_slot", "revolve_face", "sweep_face", "loft_faces"):
        assert listed[tool_id] == "this", tool_id
    assert listed["shell"] is None
    assert all(t.interaction in (None, "this", "others") for t in TOOLS.values())


def test_a_reply_reports_the_value_that_applies():
    session = session_with(two_blocks())
    face = top_face_of(session.document.current, 0)
    request = {"type": "tool_preview", "tool": "push_pull", "selection": {"faces": [face]}, "params": {"distance": 5}}
    assert header(session.handle(request))["interact"] == {"value": "this", "options": ["this", "others"]}
    assert header(session.handle({**request, "interact": "others"}))["interact"]["value"] == "others"
    assert header(session.handle({**request, "type": "tool_commit", "interact": "others"}))["interact"]["value"] == "others"
    assert "interact" not in header(session.handle({"type": "tool_preview", "tool": "shell", "selection": {"faces": [face]}, "params": {"thickness": 2}}))
    asked = {"type": "tool_handles", "tool": "push_pull", "selection": {"faces": [face]}, "params": {"distance": 5}}
    assert session.handle({**asked, "interact": "others"})["interact"] == {"value": "others", "options": ["this", "others"]}
    assert "interact" not in session.handle({**asked, "tool": "shell", "params": {}})


def test_a_loose_region_offers_only_other_bodies():
    from pliable.interaction import effective

    scene, face = _region_above_block(load_demo("block"), toward=True)
    scene.interact = "this"
    assert effective(get_tool("push_pull"), scene, Selection(faces=[face])) == ("others", ["others"])
    assert effective(get_tool("push_pull"), scene, Selection(faces=[top_face_of(scene, 0)])) == ("this", ["this", "others"])


@pytest.mark.parametrize("extent", ["last", "through"])
def test_an_extent_pull_under_this_body_ends_on_the_neighbor_but_does_not_merge_into_it(extent):
    solids = solids_of(pull(two_blocks(), "this", extent=extent).shape)
    assert len(solids) == 2
    assert round(volume_of(solids[0])) == 40 * 30 * 60  # block (20) plus a pad that reaches the neighbor's far face
    assert round(volume_of(solids[1])) == 40 * 30 * 20  # the neighbor is as it was
    assert len(solids_of(pull(two_blocks(), "others", extent=extent).shape)) == 1


def test_an_extent_cut_touches_only_its_own_body_under_this_body():
    with pytest.raises(OperationError, match="does not reach any body"):
        pull(two_blocks(), "this", extent="through", mode="subtract")  # the pad lies in the neighbor only, which is not cut
    solids = solids_of(pull(two_blocks(), "others", extent="through", mode="subtract").shape)
    assert len(solids) == 1  # under other bodies the neighbor is cut away entirely (the pad is as large as it)


def test_a_new_hole_stays_in_its_body_under_this_body_and_cuts_the_copy_under_other_bodies():
    block = solids_of(Topology(load_demo("block")).shape)[0]
    for interact, copy_cut in (("this", False), ("others", True)):
        scene = _with_copy_of(block)
        scene.interact = interact
        result = get_tool("add_hole").execute(scene, Selection(faces=[top_face_of(scene, 0)]), {"diameter": 6, "depth": 0}, preview=False)
        solids = solids_of(result.shape)
        assert volume_of(solids[0]) < 24000 - 1
        assert (volume_of(solids[1]) < 24000 - 1) == copy_cut


def test_a_boss_stays_in_its_body_under_this_body():
    block = solids_of(Topology(load_demo("block")).shape)[0]
    scene = Topology(_compound([block, (Pos(0, 0, 25) * Box(80, 80, 6)).wrapped]))  # a slab the boss grows into
    face = top_face_of(scene, 0)
    for interact, fused in (("this", False), ("others", True)):
        scene.interact = interact
        result = get_tool("add_boss").execute(scene, Selection(faces=[face]), {"diameter": 8, "height": 30}, preview=False)
        assert (len(solids_of(result.shape)) == 1) == fused


def test_up_to_face_ends_on_a_face_of_a_locked_body_and_refuses_a_hidden_one():
    scene = two_blocks(locked=True)
    target = bottom_face_id(scene, 1)
    for interact in ("this", "others"):  # a locked body is a reference in both
        scene.interact = interact
        result = get_tool("push_pull").execute(scene, Selection(faces=[top_face_of(scene, 0)]), {"distance": 5, "target": target}, preview=False)
        solids = solids_of(result.shape)
        assert len(solids) == 2 and round(volume_of(solids[0])) == 40 * 30 * 40  # the pad stops on the locked body's lower face
        assert solids[1].IsSame(solids_of(scene.shape)[1])
    free = two_blocks()
    target = bottom_face_id(free, 1)
    free.interact = "this"
    run = lambda: get_tool("push_pull").execute(free, Selection(faces=[top_face_of(free, 0)]), {"distance": 5, "target": target}, preview=False)
    assert len(solids_of(run().shape)) == 2  # not fused into the visible neighbor under "this"
    free.hidden_bodies = frozenset({free.bodies.bodies[1].id})
    with pytest.raises(OperationError, match="hidden body"):
        run()

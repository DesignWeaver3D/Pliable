"""What the Hole Editor card makes of a selection."""

import pytest

from pliable.demos import load_demo
from pliable.hole_selection import classify
from pliable.tools import Selection
from pliable.topology import Topology
from test_features import faces_where, run, top_of
from test_holes import drilled, only_hole
from test_split_holes import halves, split_hole_block


@pytest.fixture
def block():
    return Topology(load_demo("block"))


def kind(topology, **picks):
    return classify(topology, Selection(**picks))["kind"]


def test_nothing_is_none_and_a_flat_face_is_a_place_for_a_new_hole(block):
    assert kind(block) == "none"
    assert kind(block, faces=[top_of(block)]) == "new"
    assert kind(block, faces=[top_of(block), 0]) == "none"


def test_any_face_the_rim_or_a_split_wall_of_a_hole_is_that_hole(block):
    part = drilled(block, "add_counterbore", diameter=6, depth=0, bore_diameter=12, bore_depth=4)
    hole = only_hole(part)
    for face in hole.faces:
        assert kind(part, faces=[face]) == "hole"
    assert kind(part, edges=[hole.rim_edges[0]]) == "hole"
    assert kind(part, faces=list(hole.faces)) == "hole"
    assert classify(part, Selection(faces=[hole.faces[0]]))["wall"] is not None
    assert classify(part, Selection(edges=[hole.rim_edges[0]]))["pick"] == "other"
    picks = {classify(part, Selection(faces=[f]))["pick"] for f in hole.faces}
    assert picks == {"wall", "other"}
    split = split_hole_block()
    assert kind(split, faces=halves(split)) == "hole" and kind(split, faces=halves(split)[:1]) == "hole"


def test_several_holes_need_their_walls_and_a_boss_is_not_a_hole(block):
    part = drilled(block, "add_hole", diameter=4, depth=0)
    part = Topology(run("add_hole", part, faces=[top_of(part)], diameter=4, depth=0, offset_u=10).shape)
    walls = faces_where(part, "Cylinder", Radius=2)
    assert len(walls) == 2 and kind(part, faces=walls) == "holes" and classify(part, Selection(faces=walls))["count"] == 2
    boss = Topology(run("add_cylinder", block, diameter=10, height=10, x=0, y=0, z=10).shape)
    (wall,) = faces_where(boss, "Cylinder", Radius=5)
    assert kind(boss, faces=[wall]) == "boss"
    assert kind(boss, faces=[wall, top_of(boss)]) == "none"


def test_the_server_answers_the_hole_selection_request():
    from pliable.server import Session

    session = Session()
    session.handle({"type": "open_demo", "name": "block"})
    block = Topology(load_demo("block"))
    reply = session.handle({"type": "hole_selection", "selection": {"faces": [top_of(block)]}})
    assert reply["kind"] == "new"

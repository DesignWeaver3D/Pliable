"""Watch list corners: push/pull on a full cylinder wall, diagnostics scrubbing of paths with spaces, ellipse short radius limits."""

import math

import pytest

from pliable import sketch
from pliable.demos import load_demo
from pliable.server import RequestError, Session
from pliable.topology import Topology
from test_features import faces_where, run, volume
from test_sketch import sketch_of
from test_watch_modeling import block_face


def test_push_pull_on_a_boss_wall_grows_or_shrinks_the_boss():
    block = Topology(load_demo("block"))
    boss = Topology(run("add_cylinder", block, diameter=10, height=10, x=0, y=0, z=10).shape)
    (wall,) = faces_where(boss, "Cylinder", Radius=5)
    for distance in (2, -2):
        result = run("push_pull", boss, faces=[wall], distance=distance)
        assert volume(result.shape) - volume(boss.shape) == pytest.approx(math.pi * 10 * ((5 + distance) ** 2 - 25), rel=1e-6)
    assert volume(boss.shape) == pytest.approx(24000 + math.pi * 250)


def test_push_pull_on_a_hole_wall_shrinks_or_grows_the_hole():
    block = Topology(load_demo("block"))
    holed = Topology(run("add_hole", block, faces=[block_face(block, 0, 0, 1)], diameter=10, depth=8).shape)
    (wall,) = faces_where(holed, "Cylinder", Radius=5)
    # Pulling along the wall normal (which points into the void) fills the hole; pushing against it widens it.
    smaller = run("push_pull", holed, faces=[wall], distance=2)
    assert volume(smaller.shape) - volume(holed.shape) == pytest.approx(math.pi * 8 * (25 - 9), rel=1e-6)
    wider = run("push_pull", holed, faces=[wall], distance=-1)
    assert volume(holed.shape) - volume(wider.shape) == pytest.approx(math.pi * 8 * (36 - 25), rel=1e-6)


def test_a_free_standing_cylinder_is_read_as_a_boss():
    block = Topology(load_demo("block"))
    free = Topology(run("add_cylinder", block, diameter=10, height=10, x=100, y=0, z=0, new_body=1).shape)
    (wall,) = faces_where(free, "Cylinder", Radius=5)
    grown = run("push_pull", free, faces=[wall], distance=2)
    assert volume(grown.shape) - volume(free.shape) == pytest.approx(math.pi * 10 * (49 - 25), rel=1e-6)
    shrunk = run("push_pull", free, faces=[wall], distance=-2)
    assert volume(free.shape) - volume(shrunk.shape) == pytest.approx(math.pi * 10 * (25 - 9), rel=1e-6)


def test_scrub_removes_a_path_with_spaces():
    from pliable import diagnostics

    assert diagnostics.scrub(r"open C:\Users\Jane Doe\My Models\part.step failed") == "open part.step failed"
    assert diagnostics.scrub(r"copy C:\Users\Jane Doe\a.step to D:\Backup Files\b.step") == "copy a.step to b.step"
    assert diagnostics.scrub("read /Users/Jane Doe/My Models/part.step now") == "read part.step now"


def test_scrub_handles_quoted_paths_and_embedded_names():
    from pliable import diagnostics

    assert diagnostics.scrub(r"error in 'C:\Users\someone\models\part.step'") == "error in 'part.step'"
    assert diagnostics.scrub("x=/home/someone/models/part.step;") == "x=part.step;"


def test_an_ellipse_short_radius_is_dimensioned_but_not_tied_to_other_geometry():
    points = [{"id": 1, "u": 0, "v": 0}, {"id": 2, "u": 10, "v": 0}, {"id": 3, "u": 40, "v": 0}, {"id": 4, "u": 50, "v": 0}]
    entities = [{"id": 10, "type": "ellipse", "center": 1, "major": 2, "minor": 3}, {"id": 11, "type": "circle", "center": 3, "radius": 5}, {"id": 12, "type": "line", "a": 3, "b": 4}]
    fixed = [{"id": 40, "type": "fixed", "point": 1}, {"id": 41, "type": "fixed", "point": 2}]
    dimensioned = sketch.solve(sketch_of(points, entities, fixed + [{"id": 50, "type": "minor_radius", "entity": 10, "value": 4}]))
    assert dimensioned["status"] == "ok" and dimensioned["radii"][10] == 4
    session = Session()
    for constraint in ({"type": "equal", "entities": [10, 11]}, {"type": "tangent", "entities": [10, 11]}, {"type": "tangent", "entities": [10, 12]}, {"type": "radius", "entity": 10, "value": 3}):
        with pytest.raises((RequestError, sketch.SketchError)):
            session.handle({"type": "sketch_solve", "sketch": sketch_of(points, entities, fixed + [{"id": 51, **constraint}])})

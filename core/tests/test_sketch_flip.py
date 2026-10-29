"""Flipping a sketch to the other side of its plane keeps every point where it is in space."""

import pytest
from OCP.Bnd import Bnd_Box
from OCP.BRepBndLib import BRepBndLib
from OCP.BRepGProp import BRepGProp
from OCP.GProp import GProp_GProps

from pliable import sketch
from pliable.server import Session

XZ = sketch.STANDARD_PLANES["XZ"]


def _world(content):
    origin, x, y, _ = sketch.frame(content["plane"])
    return {p["id"]: tuple(origin[k] + p["u"] * x[k] + p["v"] * y[k] for k in range(3)) for p in content["points"]}


def _d_shape(plane):
    """A half disc: a bottom line and an arc over the top, with a dimension, an angle, a symmetric pair, an arc radius
    and a dimension text placed off to one side."""
    return {
        "plane": plane,
        "points": [
            {"id": 1, "u": 0, "v": 0}, {"id": 2, "u": 10, "v": 0.2}, {"id": 3, "u": 5, "v": 0},
            {"id": 5, "u": 5, "v": -4}, {"id": 6, "u": 5, "v": 4},
        ],
        "entities": [
            {"id": 10, "type": "line", "a": 1, "b": 2},
            {"id": 11, "type": "arc", "center": 3, "start": 2, "end": 1},
            {"id": 12, "type": "line", "a": 5, "b": 6, "construction": True},
        ],
        "constraints": [
            {"id": 20, "type": "fixed", "point": 1},
            {"id": 21, "type": "fixed", "point": 5},
            {"id": 22, "type": "fixed", "point": 6},
            {"id": 23, "type": "symmetric", "points": [1, 2], "entity": 12},
            {"id": 24, "type": "angle", "entities": [10, 12], "value": 90, "reference": True, "place": [7, 3]},
            {"id": 25, "type": "radius", "entity": 11, "value": 5, "reference": True},
            {"id": 26, "type": "point_on", "point": 3, "entity": 10},
        ],
    }


def _solved(content):
    result = Session().handle({"type": "sketch_solve", "sketch": content})
    assert result["status"] == "ok"
    return result


def _volume_and_box(shape):
    props = GProp_GProps()
    BRepGProp.VolumeProperties_s(shape, props)
    box = Bnd_Box()
    BRepBndLib.Add_s(shape, box)
    return props.Mass(), (box.CornerMin().X(), box.CornerMin().Y(), box.CornerMin().Z(), box.CornerMax().X(), box.CornerMax().Y(), box.CornerMax().Z())


def test_flip_reverses_the_normal_and_keeps_every_point_in_space():
    content = _d_shape(XZ)
    flipped = sketch.flip_sketch(content)
    assert flipped["plane"]["normal"] == [0, 1, 0]  # XZ's normal is -y
    assert flipped["plane"]["xdir"] == XZ["xdir"]
    for pid, spot in _world(content).items():
        assert _world(flipped)[pid] == pytest.approx(spot)
    assert content["plane"] == XZ  # the original is not changed
    assert [p["v"] for p in flipped["points"]] == [-p["v"] for p in content["points"]]


def test_flip_twice_gives_the_sketch_back():
    content = _d_shape(XZ)
    twice = sketch.flip_sketch(sketch.flip_sketch(content))
    assert twice["points"] == content["points"] and twice["entities"] == content["entities"] and twice["constraints"] == content["constraints"]
    assert twice["plane"]["normal"] == pytest.approx(content["plane"]["normal"])


def test_arcs_swap_ends_and_dimension_places_follow():
    flipped = sketch.flip_sketch(_d_shape(XZ))
    arc = next(e for e in flipped["entities"] if e["type"] == "arc")
    assert (arc["start"], arc["end"]) == (1, 2)
    assert next(c for c in flipped["constraints"] if c["id"] == 24)["place"] == [7, -3]


def test_constraints_still_solve_to_the_same_places_after_a_flip():
    content = _solved(_d_shape(XZ))
    solved = {**_d_shape(XZ), "points": content["points"]}
    flipped = sketch.flip_sketch(solved)
    again = _solved(flipped)
    after = {**flipped, "points": again["points"]}
    for pid, spot in _world(solved).items():
        assert _world(after)[pid] == pytest.approx(spot, abs=1e-6)
    assert again["dof"] == content["dof"] if "dof" in content else True


def _angled_lines():
    return {
        "plane": XZ,
        "points": [{"id": 1, "u": 0, "v": 0}, {"id": 2, "u": 10, "v": 1}, {"id": 3, "u": 5, "v": 9}, {"id": 4, "u": 4, "v": 3}],
        "entities": [{"id": 10, "type": "line", "a": 1, "b": 2}, {"id": 11, "type": "line", "a": 1, "b": 3}],
        "constraints": [
            {"id": 20, "type": "fixed", "point": 1},
            {"id": 21, "type": "horizontal", "entity": 10},
            {"id": 22, "type": "distance", "points": [1, 2], "value": 10},
            {"id": 23, "type": "angle", "entities": [10, 11], "value": 60},
            {"id": 24, "type": "distance", "points": [1, 3], "value": 8},
            {"id": 25, "type": "point_line_distance", "point": 4, "entity": 10, "value": 3},
            {"id": 26, "type": "distance", "points": [1, 4], "value": 6, "place": [2, 2]},
        ],
    }


def test_driving_angle_and_signed_distances_keep_their_side_after_a_flip():
    solved = _solved(_angled_lines())
    base = {**_angled_lines(), "points": solved["points"]}
    flipped = sketch.flip_sketch(base)
    again = _solved(flipped)
    after = {**flipped, "points": again["points"]}
    for pid, spot in _world(base).items():
        assert _world(after)[pid] == pytest.approx(spot, abs=1e-6)
    # the point stays on the same side of its line (above it in the world, which is below it in the flipped v)
    assert solved["points"][3]["v"] > 0 and again["points"][3]["v"] < 0


def test_ellipse_arc_ends_swap_and_stay_on_the_ellipse():
    content = {
        "plane": XZ,
        "points": [{"id": 1, "u": 0, "v": 0}, {"id": 2, "u": 10, "v": 0}, {"id": 4, "u": -10, "v": 0}, {"id": 5, "u": 0, "v": 5}, {"id": 6, "u": 0, "v": -5}, {"id": 7, "u": 10, "v": 0}, {"id": 8, "u": 0, "v": 5}],
        "entities": [{"id": 3, "type": "ellipse", "center": 1, "major": 2, "major2": 4, "minor1": 5, "minor2": 6, "minor": 5, "start": 7, "end": 8}],
        "constraints": [],
    }
    flipped = sketch.flip_sketch(content)
    ellipse = flipped["entities"][0]
    assert (ellipse["start"], ellipse["end"]) == (8, 7)
    assert _solved(flipped)


def test_extrusion_of_a_flipped_sketch_fills_the_same_place_but_runs_the_other_way():
    from OCP.TopoDS import TopoDS_Compound
    from OCP.BRep import BRep_Builder

    content = _solved(_d_shape(XZ))
    content = {**_d_shape(XZ), "points": content["points"]}
    flipped = sketch.flip_sketch(content)
    empty = TopoDS_Compound()
    BRep_Builder().MakeCompound(empty)
    original = sketch.extrude(empty, content, 6, "new")
    reversed_ = sketch.extrude(empty, flipped, 6, "new")
    volume_a, box_a = _volume_and_box(original.shape)
    volume_b, box_b = _volume_and_box(reversed_.shape)
    assert volume_a == pytest.approx(volume_b)
    # XZ's normal is -y, so the original runs to negative y and the flipped one to positive y
    assert box_a[1] == pytest.approx(-6) and box_a[4] == pytest.approx(0, abs=1e-6)
    assert box_b[1] == pytest.approx(0, abs=1e-6) and box_b[4] == pytest.approx(6)
    assert box_a[0] == pytest.approx(box_b[0]) and box_a[3] == pytest.approx(box_b[3])
    assert box_a[2] == pytest.approx(box_b[2]) and box_a[5] == pytest.approx(box_b[5])


def test_session_handles_sketch_flip():
    reply = Session().handle({"type": "sketch_flip", "sketch": _d_shape(XZ)})
    assert reply["sketch"]["plane"]["normal"] == [0, 1, 0]

import math

import pytest
from build123d import Cylinder
from OCP.BRepAdaptor import BRepAdaptor_Surface
from OCP.BRepGProp import BRepGProp
from OCP.GeomAbs import GeomAbs_Cylinder
from OCP.GProp import GProp_GProps

from pliable import unwrap
from pliable.sketch import STANDARD_PLANES
from pliable.topology import Topology


def _side_face(topology):
    return next(i for i in range(topology.face_count) if BRepAdaptor_Surface(topology.face(i)).GetType() == GeomAbs_Cylinder)


def _area(face) -> float:
    props = GProp_GProps()
    BRepGProp.SurfaceProperties_s(face, props, 1e-7, False)
    return props.Mass()


def _rectangle(w, h, cx=0.0, cy=0.0):
    corners = [(cx - w / 2, cy - h / 2), (cx + w / 2, cy - h / 2), (cx + w / 2, cy + h / 2), (cx - w / 2, cy + h / 2)]
    points = [{"id": i + 1, "u": u, "v": v} for i, (u, v) in enumerate(corners)]
    lines = [{"id": 10 + i, "type": "line", "a": i + 1, "b": (i + 1) % 4 + 1} for i in range(4)]
    return {"plane": STANDARD_PLANES["XY"], "points": points, "entities": lines, "constraints": []}


def test_unwrapped_rectangle_and_circle_map_back_with_true_size():
    shape = Cylinder(10, 40).wrapped
    topology = Topology(shape)
    side = _side_face(topology)
    before = topology.face_count
    # the unrolled strip is 2*pi*10 wide and 40 tall
    ref = unwrap.unwrap_reference(topology.face(side))
    assert max(p["u"] for p in ref["points"]) == pytest.approx(math.pi * 10, rel=1e-6)
    assert max(p["v"] for p in ref["points"]) == pytest.approx(20, rel=1e-6)

    result, count = unwrap.wrap_regions(shape, topology, side, _rectangle(12, 8, cx=5))
    assert count == 1
    after = Topology(result)
    assert after.face_count == before + 1
    assert any(_area(after.face(i)) == pytest.approx(12 * 8, rel=1e-4) for i in range(after.face_count))  # no stretching

    circle = {"plane": STANDARD_PLANES["XY"], "points": [{"id": 1, "u": -8, "v": 3}], "entities": [{"id": 2, "type": "circle", "center": 1, "radius": 4}], "constraints": []}
    result, count = unwrap.wrap_regions(shape, topology, side, circle)
    after = Topology(result)
    assert after.face_count == before + 1
    assert any(_area(after.face(i)) == pytest.approx(math.pi * 16, rel=1e-3) for i in range(after.face_count))


def test_unwrap_refuses_a_flat_face():
    topology = Topology(Cylinder(10, 40).wrapped)
    flat = next(i for i in range(topology.face_count) if i != _side_face(topology))
    with pytest.raises(unwrap.UnwrapError):
        unwrap.unwrap_reference(topology.face(flat))

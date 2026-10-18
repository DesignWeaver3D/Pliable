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
    ref = unwrap.build_unrolling(topology, [side]).reference
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
        unwrap.build_unrolling(topology, [flat])


def _faces_of(topology, kind):
    return [i for i in range(topology.face_count) if BRepAdaptor_Surface(topology.face(i)).GetType() == kind]


def test_region_across_the_seam_of_a_full_cylinder():
    shape = Cylinder(10, 40).wrapped
    topology = Topology(shape)
    side = _side_face(topology)
    width = 2 * math.pi * 10
    # a rectangle centred on the edge of the unrolled strip: it wraps round the seam
    result, count = unwrap.wrap_regions(shape, topology, side, _rectangle(12, 8, cx=width / 2))
    after = Topology(result)
    assert count == 1
    # the cylinder's seam splits the region into two faces, 48 each, and nothing else is lost
    halves = [i for i in range(after.face_count) if _area(after.face(i)) == pytest.approx(48, rel=1e-3)]
    assert len(halves) == 2
    assert sum(_area(after.face(i)) for i in range(after.face_count)) == pytest.approx(sum(_area(topology.face(i)) for i in range(topology.face_count)), rel=1e-4)


def test_cone_unrolls_to_a_sector_and_maps_back_with_true_size():
    from build123d import Cone
    from OCP.GeomAbs import GeomAbs_Cone

    shape = Cone(12, 5, 20).wrapped
    topology = Topology(shape)
    (side,) = _faces_of(topology, GeomAbs_Cone)
    unrolling = unwrap.build_unrolling(topology, [side])
    assert {e["type"] for e in unrolling.reference["entities"]} == {"arc", "line"}
    result, count = unwrap.wrap_regions(shape, topology, [side], _rectangle(6, 5))
    after = Topology(result)
    assert after.face_count == topology.face_count + 1
    assert any(_area(after.face(i)) == pytest.approx(30, rel=2e-3) for i in range(after.face_count))


def test_chain_of_flat_and_rounded_faces_unrolls_as_one_strip():
    from build123d import Box, fillet

    box = Box(20, 20, 10)
    edge = box.edges().filter_by(lambda e: abs(e.center().X - 10) < 1e-6 and abs(e.center().Y - 10) < 1e-6)[0]
    shape = fillet(edge, 4).wrapped
    topology = Topology(shape)
    from OCP.GeomAbs import GeomAbs_Cylinder

    (round_face,) = _faces_of(topology, GeomAbs_Cylinder)
    flats = [i for i in range(topology.face_count) if i != round_face and abs(abs(BRepAdaptor_Surface(topology.face(i)).Plane().Axis().Direction().Z()) - 1) > 1e-6 and unwrap._shared(topology.face(i), topology.face(round_face))]
    assert len(flats) == 2
    ids = [flats[0], round_face, flats[1]]
    unrolling = unwrap.build_unrolling(topology, ids)
    length = 16 + 16 + math.pi / 2 * 4  # two 16 mm flats and the quarter round
    ref = unrolling.reference
    assert max(p["u"] for p in ref["points"]) - min(p["u"] for p in ref["points"]) == pytest.approx(length, rel=1e-6)
    # a 12 wide rectangle centred on the rounded part crosses both joins
    result, count = unwrap.wrap_regions(shape, topology, ids, _rectangle(12, 8))
    after = Topology(result)
    assert after.face_count == topology.face_count + 4  # the rounded face also leaves a strip above and below the piece
    assert any(_area(after.face(i)) == pytest.approx(math.pi / 2 * 4 * 8, rel=1e-3) for i in range(after.face_count))
    # two non-adjacent faces are not a chain
    with pytest.raises(unwrap.UnwrapError):
        unwrap.build_unrolling(topology, [flats[0], flats[1]])


def test_region_across_the_edge_of_an_unrolled_cone_is_wrapped_in_two_pieces():
    from build123d import Cone
    from OCP.GeomAbs import GeomAbs_Cone

    shape = Cone(12, 5, 20).wrapped
    topology = Topology(shape)
    (side,) = _faces_of(topology, GeomAbs_Cone)
    points = unwrap.build_unrolling(topology, [side]).reference["points"]
    x, y = (points[1]["u"] + points[3]["u"]) / 2, (points[1]["v"] + points[3]["v"]) / 2  # middle of the sector's right edge
    result, _ = unwrap.wrap_regions(shape, topology, [side], _rectangle(6, 5, cx=x, cy=y))
    after = Topology(result)
    pieces = [i for i in range(after.face_count) if _area(after.face(i)) == pytest.approx(15, rel=2e-3)]
    assert len(pieces) == 2  # one on each side of the cone's seam, 30 in all

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


def _volume(shape) -> float:
    props = GProp_GProps()
    BRepGProp.VolumeProperties_s(shape, props)
    return props.Mass()


def _wrapped_session(radius=10, hole=False):
    from build123d import Cylinder as Cyl

    from pliable.server import Session

    session = Session()
    shape = Cyl(radius, 40).wrapped
    if hole:  # a bore: its wall faces the other way
        from build123d import Box

        shape = (Box(40, 40, 40) - Cyl(radius, 50)).wrapped
    session._open(shape, "cyl")
    topology = session.document.current
    side = _side_face(topology)
    plane = session.handle({"type": "sketch_plane", "unwrap": side})["plane"]
    assert plane["origin"][0] > 20  # drawn beside the model, not over it
    session.handle({"type": "sketch_regions", "unwrap": side, "sketch": {**_rectangle(12, 8, cx=5), "plane": plane}})
    return session, 12 * 8


def _patch_id(session, area):
    topology = session.document.current
    return next(i for i in range(topology.face_count) if abs(_area(topology.face(i)) - area) < 0.5)


@pytest.mark.parametrize("hole", [False, True])
def test_wrapped_patch_can_be_embossed_and_cut_through_the_server(hole):
    from pliable.tools import get_tool

    session, area = _wrapped_session(hole=hole)
    patch = _patch_id(session, area)
    topology = session.document.current
    assert not get_tool("push_pull").available(topology, __import__("pliable.tools", fromlist=["x"]).Selection(faces=[patch]))
    base = _volume(topology.shape)
    for distance, grows in ((2.0, True), (-2.0, False)):
        reply = session.handle({"type": "tool_commit", "tool": "push_pull_surface", "selection": {"faces": [patch]}, "params": {"distance": distance}})
        assert isinstance(reply, bytes)
        v = _volume(session.document.current.shape)
        assert (v > base) == grows, (hole, distance, v, base)
        assert abs(v - base) > 100  # about 12 x 8 x 2
        session.handle({"type": "undo"})
        assert _volume(session.document.current.shape) == pytest.approx(base, rel=1e-9)


def test_chain_and_cone_through_the_server_use_the_offset_plane_and_can_be_embossed():
    from build123d import Box, Cone, fillet
    from OCP.GeomAbs import GeomAbs_Cone

    from pliable.server import Session

    # cone: a patch drawn on the unrolled sector, then embossed
    session = Session()
    session._open(Cone(12, 5, 20).wrapped, "cone")
    topology = session.document.current
    (side,) = _faces_of(topology, GeomAbs_Cone)
    plane = session.handle({"type": "sketch_plane", "unwrap": [side]})["plane"]
    assert plane["origin"][0] > 12
    session.handle({"type": "sketch_regions", "unwrap": [side], "sketch": {**_rectangle(6, 5), "plane": plane}})
    patch = _patch_id(session, 30)
    base = _volume(session.document.current.shape)
    session.handle({"type": "tool_commit", "tool": "push_pull_surface", "selection": {"faces": [patch]}, "params": {"distance": 1.5}})
    assert _volume(session.document.current.shape) > base + 30

    # chain of two flats and a round: the wrapped round piece is embossed too
    box = Box(20, 20, 10)
    edge = box.edges().filter_by(lambda e: abs(e.center().X - 10) < 1e-6 and abs(e.center().Y - 10) < 1e-6)[0]
    session = Session()
    session._open(fillet(edge, 4).wrapped, "chain")
    topology = session.document.current
    from OCP.GeomAbs import GeomAbs_Cylinder

    (round_face,) = _faces_of(topology, GeomAbs_Cylinder)
    flats = [i for i in range(topology.face_count) if i != round_face and abs(abs(BRepAdaptor_Surface(topology.face(i)).Plane().Axis().Direction().Z()) - 1) > 1e-6 and unwrap._shared(topology.face(i), topology.face(round_face))]
    ids = [flats[0], round_face, flats[1]]
    plane = session.handle({"type": "sketch_plane", "unwrap": ids})["plane"]
    session.handle({"type": "sketch_regions", "unwrap": ids, "sketch": {**_rectangle(12, 8), "plane": plane}})
    patch = _patch_id(session, math.pi / 2 * 4 * 8)
    base = _volume(session.document.current.shape)
    session.handle({"type": "tool_commit", "tool": "push_pull_surface", "selection": {"faces": [patch]}, "params": {"distance": -1.0}})
    assert _volume(session.document.current.shape) < base - 20


def test_sketch_on_face_chooses_flat_or_unrolled_and_explains_a_refusal():
    from build123d import Box, Cylinder

    from pliable.server import RequestError, Session

    # a flat face gives its own plane and outline; a cylinder side is unrolled, with the same request
    session = Session()
    session._open(Cylinder(10, 40).wrapped, "cylinder")
    topology = session.document.current
    side = _side_face(topology)
    flat = next(i for i in range(topology.face_count) if i != side)
    reply = session.handle({"type": "sketch_plane", "faces": [flat]})
    assert reply["unwrapped"] is False and reply["reference"]["entities"]
    reply = session.handle({"type": "sketch_plane", "faces": [side]})
    assert reply["unwrapped"] is True and max(p["u"] for p in reply["reference"]["points"]) == pytest.approx(math.pi * 10, rel=1e-6)

    # two faces that do not touch cannot be one sketch face: the message names the surfaces and the diagnostic
    # report records the refusal
    session = Session()
    session._open(Box(10, 10, 10).wrapped, "box")
    topology = session.document.current
    opposite = next(i for i in range(1, topology.face_count) if not unwrap._shared(topology.face(0), topology.face(i)))
    with pytest.raises(RequestError) as caught:
        session.handle({"type": "sketch_plane", "faces": [0, opposite]})
    assert "Plane x2" in str(caught.value)
    report = session.handle({"type": "diagnostics"})["report"]
    assert report["lastTool"]["tool"] == "sketch_on_face" and report["lastTool"]["ok"] is False and "chain" in report["lastTool"]["error"]


def test_a_sphere_face_flattens_approximately_and_says_how_wrong():
    from build123d import Sphere

    from pliable.server import Session

    session = Session()
    session._open(Sphere(10).wrapped, "sphere")
    reply = session.handle({"type": "sketch_plane", "faces": [0]})
    assert reply["unwrapped"] is True and reply["distortion"]["max"] > 0.3 and "Approximate" in reply["distortion"]["note"]
    assert reply["reference"]["entities"] and reply["reference"]["points"]
    # a small round patch drawn near the middle wraps back onto the sphere as a face of about that size
    plane = reply["plane"]
    circle = {"plane": plane, "points": [{"id": 1, "u": 0, "v": 0}], "entities": [{"id": 2, "type": "circle", "center": 1, "radius": 2}], "constraints": []}
    before = session.document.current.face_count
    session.handle({"type": "sketch_regions", "unwrap": [0], "sketch": circle})
    after = session.document.current
    assert after.face_count > before
    areas = sorted(_area(after.face(i)) for i in range(after.face_count))
    assert any(abs(a - math.pi * 4) / (math.pi * 4) < 0.5 for a in areas)  # roughly the drawn area, not exactly


def test_three_sides_and_two_fillets_are_one_sketch_face():
    from build123d import Box, fillet

    from pliable.server import Session

    box = Box(40, 30, 10)
    edges = box.edges().filter_by(lambda e: abs(abs(e.center().X) - 20) < 1e-6 and abs(e.center().Y - 15) < 1e-6)
    session = Session()
    session._open(fillet(list(edges), 4).wrapped, "sides")
    topology = session.document.current
    # the faces along the +y side: its flat face, the two rounds beside it and the flat faces at their far ends
    rounds = [i for i in range(topology.face_count) if _kind_is_cylinder(topology.face(i))]
    assert len(rounds) == 2
    middle = next(i for i in range(topology.face_count) if _is_vertical_flat(topology.face(i)) and all(unwrap._shared(topology.face(i), topology.face(r)) for r in rounds))
    ends = [next(i for i in range(topology.face_count) if i not in (middle, *rounds) and unwrap._shared(topology.face(i), topology.face(r)) and _is_vertical_flat(topology.face(i))) for r in rounds]
    ids = [ends[0], rounds[0], middle, rounds[1], ends[1]]
    reply = session.handle({"type": "sketch_plane", "faces": ids})
    assert reply["unwrapped"] is True and "distortion" not in reply
    width = max(p["u"] for p in reply["reference"]["points"]) - min(p["u"] for p in reply["reference"]["points"])
    assert width > 40
    session.handle({"type": "sketch_regions", "unwrap": ids, "sketch": {**_rectangle(30, 6, cx=0, cy=0), "plane": reply["plane"]}})
    assert session.document.current.face_count > topology.face_count


def _kind_is_cylinder(face):
    return BRepAdaptor_Surface(face).GetType() == GeomAbs_Cylinder


def _is_vertical_flat(face):
    surface = BRepAdaptor_Surface(face)
    return unwrap._kind(face) == unwrap.GeomAbs_Plane and abs(surface.Plane().Axis().Direction().Z()) < 1e-6


def test_embossing_a_whole_round_wall_says_it_is_push_pull_and_how_to_wrap():
    import pytest
    from build123d import Cylinder

    from pliable.ops import OperationError
    from pliable.server import Session

    session = Session()
    session._open(Cylinder(10, 20).wrapped, "boss")
    topology = session.document.current
    (side,) = _faces_of(topology, GeomAbs_Cylinder)
    with pytest.raises(OperationError, match="Push/Pull"):
        session.handle({"type": "tool_commit", "tool": "push_pull_surface", "selection": {"faces": [side]}, "params": {"distance": 2}})

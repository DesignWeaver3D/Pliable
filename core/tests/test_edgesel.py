import pytest

from pliable.demos import load_demo
from pliable.edgesel import edge_angle, edge_ring, face_edges, face_loops, outer_loop, region_boundary, shared_loop, sharp_edges
from pliable.ops import OperationError
from pliable.topology import Topology




def _face_with_hole(topology):
    for i, _ in topology.faces():
        if len(face_loops(topology, i)) > 1:
            return i
    raise AssertionError("no face with a hole")


def test_block_face_edges_and_loops():
    t = Topology(load_demo("block"))
    assert len(face_edges(t, 0)) == 4
    assert [len(loop) for loop in face_loops(t, 0)] == [4]


def test_loops_of_a_face_with_a_hole():
    t = Topology(load_demo("bracket"))
    i = _face_with_hole(t)
    loops = face_loops(t, i)
    assert len(loops) >= 2 and sorted(face_edges(t, i)) == sorted(e for loop in loops for e in loop)


def test_shared_loop_of_two_edges_on_one_face():
    t = Topology(load_demo("block"))
    loop = face_loops(t, 0)[0]
    assert sorted(shared_loop(t, loop[0], loop[1])) == sorted(loop)


def test_edges_with_no_common_face_are_rejected():
    t = Topology(load_demo("block"))
    far = next(e for e in range(t.edge_count) if not set(map(t.face_id, t.edge_faces(t.edge(e)))) & set(map(t.face_id, t.edge_faces(t.edge(0)))))
    with pytest.raises(OperationError):
        shared_loop(t, 0, far)


def test_inset_face_splits_the_top_face_into_ring_and_inner_region():
    from pliable.tools import Selection, get_tool

    t = Topology(load_demo("block"))
    top = 0
    before = len(list(t.faces()))
    result = get_tool("inset_face").execute(t, Selection(faces=[top]), {"distance": 1.0}, False)
    after = Topology(result.shape)
    assert len(list(after.faces())) == before + 1
    with pytest.raises(OperationError):
        get_tool("inset_face").execute(t, Selection(faces=[top]), {"distance": 1000.0}, False)


def test_divide_face_adds_one_face_and_rejects_a_miss():
    from pliable.tools import Selection, get_tool

    t = Topology(load_demo("block"))
    before = len(list(t.faces()))
    result = get_tool("divide_face").execute(t, Selection(faces=[0]), {"across": 0, "offset": 0.0}, False)
    assert len(list(Topology(result.shape).faces())) == before + 1
    with pytest.raises(OperationError):
        get_tool("divide_face").execute(t, Selection(faces=[0]), {"across": 1, "offset": 1000.0}, False)


def test_block_ring_has_four_parallel_edges():
    t = Topology(load_demo("block"))
    ring = edge_ring(t, 0)
    assert len(ring) == 4 and 0 in ring


def test_region_boundary_of_two_block_faces():
    t = Topology(load_demo("block"))
    shared = {f for f in range(t.face_count)}
    a = 0
    neighbour = next(
        f for f in range(1, t.face_count) if set(face_edges(t, a)) & set(face_edges(t, f))
    )
    assert len(region_boundary(t, [a, neighbour])) == 6
    assert shared


def test_sharp_edges_of_a_block_reach_all_twelve():
    t = Topology(load_demo("block"))
    assert edge_angle(t, 0) == pytest.approx(90, abs=0.5)
    assert len(sharp_edges(t, 0, 30)) == 12


def test_smooth_edge_is_not_sharp():
    t = Topology(load_demo("bracket"))
    angles = [edge_angle(t, e) for e in range(t.edge_count)]
    smooth = next(e for e, a in enumerate(angles) if a is not None and a < 1)
    with pytest.raises(OperationError):
        sharp_edges(t, smooth, 30)


def test_mesh_reports_hole_centres():
    from pliable.tessellate import tessellate

    mesh = tessellate(Topology(load_demo("bracket")))
    assert len(mesh.centres) >= 4 and all(len(c["position"]) == 3 for c in mesh.centres)


def test_inset_face_around_a_hole_loop():
    from pliable.tools import Selection, get_tool

    t = Topology(load_demo("bracket"))
    face = _face_with_hole(t)
    tool = get_tool("inset_face")
    before = t.face_count
    result = tool.execute(t, Selection(faces=[face]), {"distance": 1.0, "loop": 1}, False)
    assert Topology(result.shape).face_count > before
    with pytest.raises(OperationError):
        tool.run(t, Selection(faces=[face]), {"distance": 1.0, "loop": 9}, False)


def test_hole_centres_have_an_axis():
    from pliable.tessellate import tessellate

    mesh = tessellate(Topology(load_demo("bracket")))
    assert all(len(c["axis"]) == 3 for c in mesh.centres)


def test_split_tools_survive_the_same_surface_merge_on_the_bracket():
    """Through Tool.execute, which merges coplanar faces after every tool: a deliberate split must stay."""
    from pliable.tools import Selection, get_tool

    t = Topology(load_demo("bracket"))
    face = _face_with_hole(t)
    for tool, values in (("inset_face", {"distance": 2.0}), ("inset_face", {"distance": 1.0, "loop": 1}), ("divide_face", {"across": 0, "offset": 0.0})):
        result = get_tool(tool).execute(t, Selection(faces=[face]), values, False)
        assert Topology(result.shape).face_count > t.face_count, tool


def test_edge_loops_through_the_server_follow_shared_faces():
    from pliable.server import Session

    session = Session()
    session.handle({"type": "open_demo", "name": "block"})
    t = Topology(load_demo("block"))
    edge = face_loops(t, 0)[0][0]
    reply = session.handle({"type": "edge_selection", "mode": "edge_loops", "edge": edge})
    # a block edge borders two faces, each with a four-edge loop through it: 4 + 4 - 1 shared edge = 7
    assert len(reply["edges"]) == 7 and edge in reply["edges"]
    ring = session.handle({"type": "edge_selection", "mode": "ring", "edge": edge})
    assert edge in ring["edges"] and len(ring["edges"]) == 4


def test_ring_crosses_a_face_with_rounded_corners():
    from pliable.server import Session

    session = Session()
    session.handle({"type": "open_demo", "name": "bracket"})
    t = Topology(load_demo("bracket"))
    # the base's front face has rounded corners, so its loop has more than four edges
    ringed = []
    for edge in range(t.edge_count):
        reply = session.handle({"type": "edge_selection", "mode": "ring", "edge": edge})
        if len(reply["edges"]) > 1:
            ringed.append(edge)
    assert 27 in ringed  # the base's front-top edge now has a ring through the rounded front face


def test_face_frame_then_divide_through_the_server():
    from pliable.protocol import decode_binary
    from pliable.server import Session

    session = Session()
    session.handle({"type": "open_demo", "name": "block"})
    frame = session.handle({"type": "face_frame", "face": 0})
    # the dividing line placed where a drag would put it: a point 3 along the second axis from the centre
    point = [c + 3 * v for c, v in zip(frame["centre"], frame["v"])]
    offset = sum((p - c) * v for p, c, v in zip(point, frame["centre"], frame["v"]))
    before = session.document.current.face_count
    header, _ = decode_binary(session.handle({"type": "tool_commit", "tool": "divide_face", "selection": {"faces": [0]}, "params": {"across": 0, "offset": offset}}))
    assert len(header["faces"]) == before + 1 and header["canUndo"]
    assert session.handle({"type": "face_frame", "face": 0}) is not None


def test_outer_loop_leaves_out_holes():
    t = Topology(load_demo("bracket"))
    i = _face_with_hole(t)
    outer = outer_loop(t, i)
    assert outer and len(outer) < len(face_edges(t, i))
    assert all(e in face_edges(t, i) for e in outer)


def test_inset_every_edge_splits_the_outline_and_the_hole_ring():
    from pliable.tools import Selection, get_tool

    t = Topology(load_demo("bracket"))
    face = _face_with_hole(t)
    tool = get_tool("inset_face")
    one = tool.execute(t, Selection(faces=[face]), {"distance": 1.0}, False)
    every = tool.execute(t, Selection(faces=[face]), {"distance": 1.0, "all_loops": 1}, False)
    assert Topology(every.shape).face_count > Topology(one.shape).face_count


def test_inset_and_draft_offer_handles_that_follow_their_values():
    from pliable.tools import Selection, get_tool
    from pliable.ops import planar_normal

    t = Topology(load_demo("bracket"))
    face = _face_with_hole(t)
    inset = get_tool("inset_face")
    a = inset.handles(t, Selection(faces=[face]), {"distance": 1.0, "loop": 0, "all_loops": 0})
    b = inset.handles(t, Selection(faces=[face]), {"distance": 3.0, "loop": 0, "all_loops": 0})
    assert [h.param for h in a] == ["distance", "all_loops"]
    moved = sum((q - p) * d for p, q, d in zip(a[0].anchor, b[0].anchor, a[0].direction))
    assert moved == pytest.approx(2.0)

    block = Topology(load_demo("block"))
    wall = next(i for i in range(block.face_count) if (n := planar_normal(block.face(i))) is not None and abs(n.Z()) < 1e-6)
    draft = get_tool("draft")
    values = {"angle": 0.0, "pull_x": 0.0, "pull_y": 0.0, "pull_z": 1.0}
    (h0,) = draft.handles(block, Selection(faces=[wall]), values)
    (h1,) = draft.handles(block, Selection(faces=[wall]), {**values, "angle": 10.0})
    assert h0.param == "angle" and h0.ring is not None
    assert h0.anchor != h1.anchor


def _bracket_top_with_holes():
    from build123d import Face

    t = Topology(load_demo("bracket"))
    face = next(i for i, _ in t.faces() if len(Face(t.face(i)).inner_wires()) == 4 and t.face(i) is not None and Face(t.face(i)).center().Z > 0)
    return t, face


def _solids(shape):
    from OCP.TopAbs import TopAbs_SOLID
    from OCP.TopExp import TopExp_Explorer

    explorer, count = TopExp_Explorer(shape, TopAbs_SOLID), 0
    while explorer.More():
        count += 1
        explorer.Next()
    return count


def _inset(t, face, distance, **extra):
    from pliable.tools import Selection, get_tool

    result = get_tool("inset_face").execute(t, Selection(faces=[face]), {"distance": distance, **extra}, False)
    return Topology(result.shape), result


def test_inset_without_overlap_keeps_the_ring_per_edge():
    t, face = _bracket_top_with_holes()
    after, result = _inset(t, face, 2.0, all_loops=1)
    assert after.face_count == t.face_count + 5  # inner region, outer band and four hole rings
    assert _solids(result.shape) == _solids(t.shape) == 1
    assert _inset(t, face, 2.0)[0].face_count == t.face_count + 1


def test_inset_hole_band_meets_the_outer_band():
    t, face = _bracket_top_with_holes()
    apart, _ = _inset(t, face, 3.0, all_loops=1)
    merged, result = _inset(t, face, 4.0, all_loops=1)  # the hole rings reach the outer band here
    assert merged.face_count < apart.face_count and merged.face_count > t.face_count
    assert _solids(result.shape) == 1


def test_inset_two_hole_bands_meet():
    t, face = _bracket_top_with_holes()
    before, _ = _inset(t, face, 9.0, all_loops=1)
    after, result = _inset(t, face, 11.0, all_loops=1)  # the two holes 28 apart have bands that cross past 10
    assert after.face_count != before.face_count and after.face_count > t.face_count
    assert _solids(result.shape) == 1
    assert after.face_count < t.face_count + 9  # merged bands, not one extra face per crossing


def test_inset_bands_covering_everything_leave_nothing():
    t, face = _bracket_top_with_holes()
    with pytest.raises(OperationError):
        _inset(t, face, 30.0, all_loops=1)
    with pytest.raises(OperationError):
        _inset(t, face, 30.0)
    with pytest.raises(OperationError):
        _inset(t, face, 80.0, loop=1)

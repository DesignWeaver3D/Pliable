import pytest

from pliable.demos import load_demo
from pliable.edgesel import edge_angle, edge_ring, face_edges, face_loops, region_boundary, shared_loop, sharp_edges
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

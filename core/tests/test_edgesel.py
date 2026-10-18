import pytest

from pliable.demos import load_demo
from pliable.edgesel import face_edges, face_loops, shared_loop
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
    result = get_tool("inset_face").run(t, Selection(faces=[top]), {"distance": 1.0}, False)
    after = Topology(result.shape)
    assert len(list(after.faces())) == before + 1
    with pytest.raises(OperationError):
        get_tool("inset_face").run(t, Selection(faces=[top]), {"distance": 1000.0}, False)


def test_divide_face_adds_one_face_and_rejects_a_miss():
    from pliable.tools import Selection, get_tool

    t = Topology(load_demo("block"))
    before = len(list(t.faces()))
    result = get_tool("divide_face").run(t, Selection(faces=[0]), {"across": 0, "offset": 0.0}, False)
    assert len(list(Topology(result.shape).faces())) == before + 1
    with pytest.raises(OperationError):
        get_tool("divide_face").run(t, Selection(faces=[0]), {"across": 1, "offset": 1000.0}, False)

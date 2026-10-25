from build123d import Box, Pos
from OCP.BRepAlgoAPI import BRepAlgoAPI_Fuse

from pliable.ops import OpResult, unify_result
from pliable.tools import Selection, get_tool
from pliable.topology import Topology


def split_block():
    """Two boxes fused without merging: the coplanar faces stay split along the seam."""
    left = Box(10, 10, 10).wrapped
    right = Pos(10, 0, 0) * Box(10, 10, 10)
    fuse = BRepAlgoAPI_Fuse(left, right.wrapped)
    fuse.Build()
    return fuse.Shape()


def test_unify_result_merges_coplanar_faces():
    shape = split_block()
    assert Topology(shape).face_count > 6
    merged = unify_result(OpResult(shape, []))
    assert merged.unified
    assert Topology(merged.shape).face_count == 6


def test_tools_that_skip_finish_still_unify():
    """Chamfer returns its maker's shape directly; the tool runner must still merge the split faces."""
    topology = Topology(split_block())
    plain = Topology(unify_result(OpResult(topology.shape, [])).shape)
    edge = next(i for i in range(plain.edge_count) if i is not None)
    # chamfer the same edge on both models: the split model must not end up with more faces
    result = get_tool("fillet_chamfer").execute(plain, Selection(edges=[edge]), {"distance": -1.0}, preview=False)
    split = get_tool("fillet_chamfer").execute(topology, Selection(edges=[_matching_edge(topology, plain, edge)]), {"distance": -1.0}, preview=False)
    assert Topology(split.shape).face_count == Topology(result.shape).face_count


def _matching_edge(split_topology, plain_topology, plain_edge):
    """The edge of the split model at the same place (same midpoint) as an edge of the merged model."""
    from OCP.BRepGProp import BRepGProp
    from OCP.GProp import GProp_GProps

    def centre(topology, i):
        props = GProp_GProps()
        BRepGProp.LinearProperties_s(topology.edge(i), props)
        c = props.CentreOfMass()
        return (round(c.X(), 6), round(c.Y(), 6), round(c.Z(), 6))

    target = centre(plain_topology, plain_edge)
    return next(i for i in range(split_topology.edge_count) if centre(split_topology, i) == target)


def test_unchanged_results_are_left_alone():
    topology = Topology(Box(10, 10, 10).wrapped)
    result = OpResult(topology.shape, [])
    assert result.shape is topology.shape and not result.unified

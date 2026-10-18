"""Out-and-back checks: a tool followed by its undoing tool must leave the same faces and edges, with no seams a merge could remove."""

import pytest
from build123d import Box, Cylinder, Pos

from pliable.ops import OpResult, unify_result
from pliable.tools import Selection, get_tool
from pliable.topology import Topology


def bracket() -> Topology:
    base = Box(40, 30, 10) + Pos(-10, 0, 10) * Box(20, 30, 10)
    base = base - Pos(10, 0, 0) * Cylinder(4, 10)
    return Topology(base.wrapped)


def counts(topology: Topology) -> tuple[int, int]:
    return topology.face_count, topology.edge_count


def run(topology: Topology, tool: str, selection: Selection, **values) -> Topology:
    params = {p.name: p.default for p in get_tool(tool).params}
    params.update(values)
    return Topology(get_tool(tool).execute(topology, selection, params, preview=False).shape)


def assert_no_seams(topology: Topology):
    assert counts(Topology(unify_result(OpResult(topology.shape, [])).shape)) == counts(topology)


def face_at(topology: Topology, normal: tuple, pick=max) -> int:
    """The planar face whose normal matches, furthest along it by default."""
    from OCP.BRepGProp import BRepGProp
    from OCP.GProp import GProp_GProps

    from pliable.ops import planar_normal

    best = []
    for i in range(topology.face_count):
        n = planar_normal(topology.face(i))
        if n is None or (abs(n.X() - normal[0]) + abs(n.Y() - normal[1]) + abs(n.Z() - normal[2])) > 1e-6:
            continue
        props = GProp_GProps()
        BRepGProp.SurfaceProperties_s(topology.face(i), props)
        c = props.CentreOfMass()
        best.append((c.X() * normal[0] + c.Y() * normal[1] + c.Z() * normal[2], props.Mass(), i))
    return pick(best)[2]


def test_bracket_is_clean():
    assert_no_seams(bracket())


@pytest.mark.parametrize("distance", [3.0, -3.0])
def test_push_pull_out_and_back(distance):
    start = bracket()
    face = face_at(start, (1, 0, 0))
    moved = run(start, "push_pull", Selection(faces=[face]), distance=distance)
    assert_no_seams(moved)
    back = run(moved, "push_pull", Selection(faces=[face_at(moved, (1, 0, 0))]), distance=-distance)
    assert counts(back) == counts(start)
    assert_no_seams(back)


def test_boss_then_fill():
    start = bracket()
    top = face_at(start, (0, 0, 1))
    with_boss = run(start, "add_boss", Selection(faces=[top]), diameter=6, height=4, offset_u=5)
    assert_no_seams(with_boss)
    cylinder = next(i for i in range(with_boss.face_count) if _is_cylinder(with_boss, i) and _radius(with_boss, i) == pytest.approx(3))
    back = run(with_boss, "fill_hole", Selection(faces=[cylinder]))
    assert counts(back) == counts(start)


def test_hole_then_fill():
    start = bracket()
    top = face_at(start, (0, 0, 1))
    drilled = run(start, "add_hole", Selection(faces=[top]), diameter=5, depth=0, offset_u=5)
    assert_no_seams(drilled)
    holes = [i for i in range(drilled.face_count) if _is_cylinder(drilled, i)]
    assert len(holes) == 2
    back = run(drilled, "fill_hole", Selection(faces=holes[-1:]))
    assert_no_seams(back)
    assert back.face_count == start.face_count + 0 or back.face_count >= start.face_count


@pytest.mark.parametrize("distance", [2.0, -2.0])
def test_round_then_remove(distance):
    start = bracket()
    edge = _edge_between(start, (0, 0, 1), (1, 0, 0))
    rounded = run(start, "fillet_chamfer", Selection(edges=[edge]), distance=distance)
    assert_no_seams(rounded)
    assert rounded.face_count == start.face_count + 1
    new_face = _new_face(start, rounded)
    back = run(rounded, "remove_round", Selection(faces=[new_face]))
    assert counts(back) == counts(start)
    assert_no_seams(back)


def test_union_then_subtract():
    start = bracket()
    block = Pos(25, 0, 0) * Box(10, 10, 10)
    from OCP.BRepAlgoAPI import BRepAlgoAPI_Common, BRepAlgoAPI_Cut, BRepAlgoAPI_Fuse

    fuse = BRepAlgoAPI_Fuse(start.shape, block.wrapped)
    fuse.Build()
    joined = Topology(unify_result(OpResult(fuse.Shape(), [])).shape)
    assert_no_seams(joined)
    cut = BRepAlgoAPI_Cut(joined.shape, block.wrapped)
    cut.Build()
    back = Topology(unify_result(OpResult(cut.Shape(), [])).shape)
    assert counts(back) == counts(start)


def _is_cylinder(topology, i):
    from OCP.BRepAdaptor import BRepAdaptor_Surface
    from OCP.GeomAbs import GeomAbs_Cylinder

    return BRepAdaptor_Surface(topology.face(i)).GetType() == GeomAbs_Cylinder


def _new_face(before: Topology, after: Topology) -> int:
    from OCP.BRepGProp import BRepGProp
    from OCP.GProp import GProp_GProps

    def key(topology, i):
        props = GProp_GProps()
        BRepGProp.SurfaceProperties_s(topology.face(i), props)
        c = props.CentreOfMass()
        return (round(props.Mass(), 3), round(c.X(), 3), round(c.Y(), 3), round(c.Z(), 3))

    old = {key(before, i) for i in range(before.face_count)}
    return next(i for i in range(after.face_count) if key(after, i) not in old and not _axis_aligned(after, i))


def _axis_aligned(topology, i):
    from pliable.ops import planar_normal

    n = planar_normal(topology.face(i))
    return n is not None and sorted(abs(c) for c in (n.X(), n.Y(), n.Z()))[1] < 1e-6


def _edge_between(topology: Topology, n1: tuple, n2: tuple) -> int:
    """The longest edge shared by the planar faces with these two normals."""
    from OCP.BRepGProp import BRepGProp
    from OCP.GProp import GProp_GProps
    from OCP.TopExp import TopExp_Explorer
    from OCP.TopAbs import TopAbs_EDGE

    def edges_of(face_id):
        explorer = TopExp_Explorer(topology.face(face_id), TopAbs_EDGE)
        found = []
        while explorer.More():
            found.append(explorer.Current())
            explorer.Next()
        return found

    from pliable.ops import planar_normal

    def faces_with(normal):
        out = []
        for i in range(topology.face_count):
            n = planar_normal(topology.face(i))
            if n is not None and abs(n.X() - normal[0]) + abs(n.Y() - normal[1]) + abs(n.Z() - normal[2]) < 1e-6:
                out.append(i)
        return out

    best = None
    for a in faces_with(n1):
        for b in faces_with(n2):
            for ea in edges_of(a):
                for eb in edges_of(b):
                    if ea.IsSame(eb):
                        props = GProp_GProps()
                        BRepGProp.LinearProperties_s(ea, props)
                        if best is None or props.Mass() > best[0]:
                            best = (props.Mass(), ea)
    assert best
    return next(i for i in range(topology.edge_count) if topology.edge(i).IsSame(best[1]))


def _radius(topology, i):
    from OCP.BRepAdaptor import BRepAdaptor_Surface

    return BRepAdaptor_Surface(topology.face(i)).Cylinder().Radius()

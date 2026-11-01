from OCP.BRep import BRep_Tool
from OCP.BRepAlgoAPI import BRepAlgoAPI_Cut
from OCP.BRepPrimAPI import BRepPrimAPI_MakeBox, BRepPrimAPI_MakeCylinder
from OCP.TopAbs import TopAbs_EDGE, TopAbs_FACE, TopAbs_SOLID, TopAbs_VERTEX
from OCP.TopExp import TopExp_Explorer
from OCP.TopoDS import TopoDS
from OCP.gp import gp_Ax2, gp_Dir, gp_Pnt

from pliable import ops, unwrap, voids
from pliable.subshapes import edges_of, sub_shapes, vertex_points


def old_loop(shape, kind):
    explorer, out = TopExp_Explorer(shape, kind), []
    while explorer.More():
        out.append(explorer.Current())
        explorer.Next()
    return out


def shapes():
    box = BRepPrimAPI_MakeBox(10, 10, 10).Shape()
    cylinder = BRepPrimAPI_MakeCylinder(gp_Ax2(gp_Pnt(5, 5, -1), gp_Dir(0, 0, 1)), 2, 12).Shape()
    return {"box": box, "cylinder": cylinder, "holed": BRepAlgoAPI_Cut(box, cylinder).Shape()}


def same_list(a, b):
    return len(a) == len(b) and all(x.IsSame(y) for x, y in zip(a, b))


def test_sub_shapes_match_the_explorer_loop():
    for name, shape in shapes().items():
        for kind in (TopAbs_SOLID, TopAbs_FACE, TopAbs_EDGE, TopAbs_VERTEX):
            assert same_list(sub_shapes(shape, kind), old_loop(shape, kind)), (name, kind)


def test_counts_keep_repeated_occurrences():
    box = shapes()["box"]
    assert len(sub_shapes(box, TopAbs_FACE)) == 6
    assert len(sub_shapes(box, TopAbs_EDGE)) == 24  # each of 12 edges is met once per face
    assert len(vertex_points(box)) == 48


def test_ops_callers_return_the_same_shapes():
    for shape in shapes().values():
        assert same_list(ops._inner_solids(shape), old_loop(shape, TopAbs_SOLID))
        assert same_list(ops._faces_of(shape), old_loop(shape, TopAbs_FACE))


def test_edges_and_vertices_match_the_old_unwrap_and_voids_copies():
    for shape in shapes().values():
        for face in sub_shapes(shape, TopAbs_FACE):
            old_edges = [TopoDS.Edge(e) for e in old_loop(face, TopAbs_EDGE)]
            assert same_list(unwrap._edges(face), old_edges)
            assert same_list(list(voids._edges(face)), old_edges)
            old_points = [BRep_Tool.Pnt_s(TopoDS.Vertex(v)) for v in old_loop(face, TopAbs_VERTEX)]
            old_tuples = [(p.X(), p.Y(), p.Z()) for p in old_points]
            assert unwrap._vertices(face) == old_tuples
            assert [(p.X(), p.Y(), p.Z()) for p in voids._vertices(face)] == old_tuples

"""Sub-shapes of a shape in TopExp_Explorer order (every occurrence, no de-duplication, no avoid shape)."""

from OCP.BRep import BRep_Tool
from OCP.TopAbs import TopAbs_EDGE, TopAbs_VERTEX
from OCP.TopExp import TopExp_Explorer
from OCP.TopoDS import TopoDS, TopoDS_Shape


def sub_shapes(shape: TopoDS_Shape, kind) -> list[TopoDS_Shape]:
    """Every sub-shape of type `kind` (a TopAbs_ShapeEnum), as the explorer yields them (not downcast)."""
    explorer, found = TopExp_Explorer(shape, kind), []
    while explorer.More():
        found.append(explorer.Current())
        explorer.Next()
    return found


def edges_of(shape: TopoDS_Shape) -> list:
    """The edges of `shape` as TopoDS_Edge, in explorer order."""
    return [TopoDS.Edge(e) for e in sub_shapes(shape, TopAbs_EDGE)]


def vertex_points(shape: TopoDS_Shape) -> list:
    """The gp_Pnt of each vertex of `shape`, in explorer order (a vertex shared by two edges appears twice)."""
    return [BRep_Tool.Pnt_s(TopoDS.Vertex(v)) for v in sub_shapes(shape, TopAbs_VERTEX)]

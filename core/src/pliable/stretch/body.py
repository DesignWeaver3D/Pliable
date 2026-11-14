"""One solid's faces, edges and vertices by number, with who touches whom, for the stretch modules."""

import numpy as np
from OCP.BRep import BRep_Tool
from OCP.BRepAdaptor import BRepAdaptor_Curve
from OCP.BRepTools import BRepTools
from OCP.TopAbs import TopAbs_EDGE, TopAbs_FACE, TopAbs_VERTEX
from OCP.TopExp import TopExp, TopExp_Explorer
from OCP.TopoDS import TopoDS
from OCP.collections import IndexedMap_TopoDS_Shape_TopTools_ShapeMapHasher as ShapeIndexedMap


def _indexed(shape, kind) -> ShapeIndexedMap:
    found = ShapeIndexedMap()
    TopExp.MapShapes_s(shape, kind, found)
    return found


def _numbers(shape, kind, within: ShapeIndexedMap) -> list[int]:
    """The numbers (in `within`) of the sub-shapes of one kind, each once, in the order the shape lists them."""
    seen, explorer = [], TopExp_Explorer(shape, kind)
    while explorer.More():
        number = within.FindIndex(explorer.Current()) - 1
        if number not in seen:
            seen.append(number)
        explorer.Next()
    return seen


class Body:
    """A solid with its faces, edges and vertices numbered from 0 in the kernel's own order (the order the model's ids follow)."""

    def __init__(self, solid):
        self.solid = solid
        self._faces, self._edges, self._vertices = (_indexed(solid, kind) for kind in (TopAbs_FACE, TopAbs_EDGE, TopAbs_VERTEX))
        self.faces = [TopoDS.Face(self._faces.FindKey(i)) for i in range(1, self._faces.Extent() + 1)]
        self.edges = [TopoDS.Edge(self._edges.FindKey(i)) for i in range(1, self._edges.Extent() + 1)]
        self.vertices = [TopoDS.Vertex(self._vertices.FindKey(i)) for i in range(1, self._vertices.Extent() + 1)]
        self.face_edges = [_numbers(face, TopAbs_EDGE, self._edges) for face in self.faces]
        self.face_vertices = [set(_numbers(face, TopAbs_VERTEX, self._vertices)) for face in self.faces]
        self.edge_vertices = [_numbers(edge, TopAbs_VERTEX, self._vertices) for edge in self.edges]
        self.edge_faces: list[list[int]] = [[] for _ in self.edges]
        for number, edges in enumerate(self.face_edges):
            for edge in edges:
                self.edge_faces[edge].append(number)
        self.vertex_edges: list[list[int]] = [[] for _ in self.vertices]
        for number, vertices in enumerate(self.edge_vertices):
            for vertex in vertices:
                self.vertex_edges[vertex].append(number)
        self._outer: dict[int, set[int]] = {}
        self._samples: dict[int, np.ndarray] = {}

    def face_number(self, face) -> int | None:
        index = self._faces.FindIndex(face)
        return index - 1 if index > 0 else None

    def edge_number(self, edge) -> int | None:
        index = self._edges.FindIndex(edge)
        return index - 1 if index > 0 else None

    def vertex_number(self, vertex) -> int | None:
        index = self._vertices.FindIndex(vertex)
        return index - 1 if index > 0 else None

    def outer_edges(self, face: int) -> set[int]:
        """The edges of the face's outside boundary (not those of the holes in it)."""
        if face not in self._outer:
            wire = BRepTools.OuterWire_s(self.faces[face])
            self._outer[face] = set() if wire.IsNull() else set(_numbers(wire, TopAbs_EDGE, self._edges))
        return self._outer[face]

    def point(self, vertex: int) -> np.ndarray:
        p = BRep_Tool.Pnt_s(self.vertices[vertex])
        return np.array([p.X(), p.Y(), p.Z()])

    def edge_samples(self, edge: int, count: int = 17) -> np.ndarray:
        """Points along the edge from its first parameter to its last (its one point for an edge shrunk to a point)."""
        if edge not in self._samples:
            if BRep_Tool.Degenerated_s(self.edges[edge]):
                self._samples[edge] = np.array([self.point(v) for v in self.edge_vertices[edge][:1]])
            else:
                curve = BRepAdaptor_Curve(self.edges[edge])
                first, last = curve.FirstParameter(), curve.LastParameter()
                points = [curve.Value(first + (last - first) * k / (count - 1)) for k in range(count)]
                self._samples[edge] = np.array([[p.X(), p.Y(), p.Z()] for p in points])
        return self._samples[edge]

    @property
    def size(self) -> float:
        """A length that says how big the solid is (the diagonal of the box around its vertices and edge samples)."""
        points = np.concatenate([self.edge_samples(e) for e in range(len(self.edges))]) if self.edges else np.zeros((1, 3))
        return float(np.linalg.norm(points.max(axis=0) - points.min(axis=0))) or 1.0

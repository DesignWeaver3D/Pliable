"""Stable indexing of a shape's faces, edges and vertices.

Face, edge and vertex ids sent to the frontend are 0-based indices into OCCT's
indexed shape maps, which are deterministic for a given shape.
"""

from OCP.TopAbs import TopAbs_EDGE, TopAbs_FACE, TopAbs_VERTEX
from OCP.TopExp import TopExp
from OCP.TopoDS import TopoDS, TopoDS_Shape
from OCP.collections import (
    IndexedDataMap_TopoDS_Shape_List_TopoDS_Shape_TopTools_ShapeMapHasher as ShapeAncestorMap,
)
from OCP.collections import IndexedMap_TopoDS_Shape_TopTools_ShapeMapHasher as ShapeIndexedMap


def _fresh_bodies(shape):
    from .bodies import fresh

    return fresh(shape)


class Topology:
    def __init__(self, shape: TopoDS_Shape, bodies=None):
        self.shape = shape
        self.bodies = bodies if bodies is not None else _fresh_bodies(shape)  # a BodyState: id and name of each solid
        self._edge_ancestors = None
        self._faces = ShapeIndexedMap()
        self._edges = ShapeIndexedMap()
        self._vertices = ShapeIndexedMap()
        TopExp.MapShapes_s(shape, TopAbs_FACE, self._faces)
        TopExp.MapShapes_s(shape, TopAbs_EDGE, self._edges)
        TopExp.MapShapes_s(shape, TopAbs_VERTEX, self._vertices)

    @property
    def face_count(self) -> int:
        return self._faces.Extent()

    @property
    def edge_count(self) -> int:
        return self._edges.Extent()

    def edge_faces(self, edge) -> list:
        """Faces adjacent to an edge (a seam edge lists its face once)."""
        if self._edge_ancestors is None:
            self._edge_ancestors = ShapeAncestorMap()
            TopExp.MapShapesAndAncestors_s(self.shape, TopAbs_EDGE, TopAbs_FACE, self._edge_ancestors)
        if not self._edge_ancestors.Contains(edge):
            return []
        return [TopoDS.Face(f) for f in self._edge_ancestors.FindFromKey(edge)]

    @property
    def vertex_count(self) -> int:
        return self._vertices.Extent()

    def vertex(self, vertex_id: int):
        if not 0 <= vertex_id < self.vertex_count:
            raise KeyError(f"no vertex {vertex_id}")
        return TopoDS.Vertex(self._vertices.FindKey(vertex_id + 1))

    def edge_id(self, edge) -> int | None:
        index = self._edges.FindIndex(edge)
        return index - 1 if index > 0 else None

    def vertex_id(self, vertex) -> int | None:
        index = self._vertices.FindIndex(vertex)
        return index - 1 if index > 0 else None

    def vertices(self):
        for i in range(self.vertex_count):
            yield i, self.vertex(i)

    def face(self, face_id: int):
        if not 0 <= face_id < self.face_count:
            raise KeyError(f"no face {face_id}")
        return TopoDS.Face(self._faces.FindKey(face_id + 1))

    def edge(self, edge_id: int):
        if not 0 <= edge_id < self.edge_count:
            raise KeyError(f"no edge {edge_id}")
        return TopoDS.Edge(self._edges.FindKey(edge_id + 1))

    def face_id(self, face) -> int | None:
        index = self._faces.FindIndex(face)
        return index - 1 if index > 0 else None

    def faces(self):
        for i in range(self.face_count):
            yield i, self.face(i)

    def edges(self):
        for i in range(self.edge_count):
            yield i, self.edge(i)

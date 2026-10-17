"""Stable indexing of a shape's faces and edges.

Face and edge ids sent to the frontend are 0-based indices into OCCT's
indexed shape maps, which are deterministic for a given shape.
"""

from OCP.TopAbs import TopAbs_EDGE, TopAbs_FACE
from OCP.TopExp import TopExp
from OCP.TopoDS import TopoDS, TopoDS_Shape
from OCP.collections import IndexedMap_TopoDS_Shape_TopTools_ShapeMapHasher as ShapeIndexedMap


class Topology:
    def __init__(self, shape: TopoDS_Shape):
        self.shape = shape
        self._faces = ShapeIndexedMap()
        self._edges = ShapeIndexedMap()
        TopExp.MapShapes_s(shape, TopAbs_FACE, self._faces)
        TopExp.MapShapes_s(shape, TopAbs_EDGE, self._edges)

    @property
    def face_count(self) -> int:
        return self._faces.Extent()

    @property
    def edge_count(self) -> int:
        return self._edges.Extent()

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

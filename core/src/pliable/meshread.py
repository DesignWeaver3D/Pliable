"""Reads the display triangles of faces as numpy arrays, every triangulation of a shape in one pass.

Asking the kernel for each node and triangle costs about a microsecond per call, which was a third of the time of a
drag step on a model with 40,000 triangles. The kernel can write all triangulations of a shape to a binary stream in
one call; `MeshReader` parses that stream with numpy. A face whose triangulation is not found in the stream (or a
stream that does not look as expected) is read node by node, with the same result.
"""

import io
import struct

import numpy as np
from OCP.BinTools import BinTools_ShapeSet
from OCP.BRep import BRep_Tool
from OCP.TopAbs import TopAbs_REVERSED
from OCP.TopLoc import TopLoc_Location
from OCP.TopoDS import TopoDS_Shape

_AMBIGUOUS = object()


def _signature(count: int, triangles: int, first, last) -> tuple:
    """What identifies a triangulation in the stream: its sizes and its first and last node."""
    return (count, triangles, tuple(first), tuple(last))


def _dump(shape: TopoDS_Shape) -> dict:
    """Nodes (n, 3 doubles), triangles (m, 3 one-based node numbers) and stored normals (or None) of every
    triangulation in `shape`, by signature. Empty when the stream is not in the expected layout."""
    writer = BinTools_ShapeSet()
    if writer.FormatNb() < 4:  # older layouts have no normals flag
        return {}
    writer.SetWithTriangles(True)
    writer.SetWithNormals(True)
    writer.Add(shape)
    stream = io.BytesIO()
    writer.WriteTriangulation(stream)
    data = stream.getvalue()
    head, newline, _ = data.partition(b"\n")
    words = head.split()
    if len(words) != 2 or words[0] != b"Triangulations" or not newline:
        return {}
    table: dict = {}
    at = len(head) + 1
    try:
        for _ in range(int(words[1])):
            count, triangles, has_uv, has_normals = struct.unpack_from("<iiBB", data, at)
            at += 18  # two counts, two flags, the deflection (a double)
            nodes = np.frombuffer(data, "<f8", 3 * count, at).reshape(count, 3)
            at += 24 * count + (16 * count if has_uv else 0)
            index = np.frombuffer(data, "<i4", 3 * triangles, at).reshape(triangles, 3)
            at += 12 * triangles
            normals = None
            if has_normals:
                normals = np.frombuffer(data, "<f4", 3 * count, at).reshape(count, 3)
                at += 12 * count
            if count == 0:
                continue
            if triangles and (index.min() < 1 or index.max() > count):
                return {}
            key = _signature(count, triangles, nodes[0].tolist(), nodes[-1].tolist())
            known = table.get(key)
            if known is None:
                table[key] = (nodes, index, normals)
            elif known is not _AMBIGUOUS and not (np.array_equal(known[0], nodes) and np.array_equal(known[1], index)):
                table[key] = _AMBIGUOUS  # two different triangulations look alike: both are read node by node
    except (struct.error, ValueError):
        return {}
    return table if at == len(data) else {}


def _by_node(triangulation) -> tuple:
    """The same three arrays as `_dump` gives, read with one kernel call per node and triangle."""
    count = triangulation.NbNodes()
    node, triangle = triangulation.Node, triangulation.Triangle
    nodes = np.array([node(i).Coord() for i in range(1, count + 1)], dtype=np.float64).reshape(count, 3)
    index = np.array([triangle(i).Get() for i in range(1, triangulation.NbTriangles() + 1)], dtype=np.int32).reshape(-1, 3)
    normals = None
    if triangulation.HasNormals():
        normal = triangulation.Normal
        rows = []
        for i in range(1, count + 1):
            n = normal(i)
            rows.append((n.X(), n.Y(), n.Z()))
        normals = np.array(rows, dtype=np.float64).reshape(count, 3)
    return nodes, index, normals


def vertex_normals(nodes: np.ndarray, index: np.ndarray) -> np.ndarray:
    """A normal per node: the normals of the triangles around it, weighted by area (what the kernel computes for a
    triangulation without stored normals). A node no triangle uses points along Z."""
    corners = index - 1
    a, b, c = nodes[corners[:, 0]], nodes[corners[:, 1]], nodes[corners[:, 2]]
    cross = np.cross(b - a, c - a)
    flat = corners.reshape(-1)
    total = np.stack([np.bincount(flat, weights=np.repeat(cross[:, k], 3), minlength=len(nodes)) for k in range(3)], axis=1)
    return _unit(total)


def _unit(vectors: np.ndarray) -> np.ndarray:
    length = np.linalg.norm(vectors, axis=1)
    empty = length == 0
    out = vectors / np.where(empty, 1.0, length)[:, None]
    out[empty] = (0.0, 0.0, 1.0)
    return out


class MeshReader:
    """Face arrays for the faces of one shape. The stream is read on the first face that needs it."""

    def __init__(self, shape: TopoDS_Shape, bulk: bool = True):
        self._shape = shape
        self._table: dict | None = None if bulk else {}

    def _raw(self, triangulation) -> tuple:
        count = triangulation.NbNodes()
        if self._table is None:
            try:
                self._table = _dump(self._shape)
            except Exception:  # the stream is a speed-up only
                self._table = {}
        if count and self._table:
            node = triangulation.Node
            found = self._table.get(_signature(count, triangulation.NbTriangles(), node(1).Coord(), node(count).Coord()))
            if found is not None and found is not _AMBIGUOUS:
                return found
        return _by_node(triangulation)

    def face_arrays(self, face):
        """Positions, normals, indices and centroid of a meshed face in model space (None for a face without a mesh)."""
        location = TopLoc_Location()
        triangulation = BRep_Tool.Triangulation_s(face, location)
        if triangulation is None:
            return None
        nodes, index, normals = self._raw(triangulation)
        if normals is None:
            normals = vertex_normals(nodes, index)
        if not location.IsIdentity():
            transform = location.Transformation()
            matrix = np.array([[transform.Value(row, column) for column in (1, 2, 3, 4)] for row in (1, 2, 3)])
            nodes = nodes @ matrix[:, :3].T + matrix[:, 3]
            normals = _unit(normals @ matrix[:, :3].T)
        corners = index - 1
        if face.Orientation() == TopAbs_REVERSED:
            normals = -normals
            corners = corners[:, [0, 2, 1]]
        positions = nodes.astype(np.float32)
        centroid = positions.mean(axis=0).tolist() if len(positions) else None
        return positions, normals.astype(np.float32), corners.astype(np.uint32).reshape(-1), centroid

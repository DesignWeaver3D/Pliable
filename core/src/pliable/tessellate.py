"""Convert BREP shapes into display meshes for the frontend.

Triangles are grouped by face so the frontend can map a picked triangle
back to its face id. Edges are sent as line-segment pairs grouped by edge.
"""

import math
from dataclasses import dataclass, field

import numpy as np
from OCP.Bnd import Bnd_Box
from OCP.BRep import BRep_Tool
from OCP.BRepAdaptor import BRepAdaptor_Curve
from OCP.BRepBndLib import BRepBndLib
from OCP.BRepMesh import BRepMesh_IncrementalMesh
from OCP.GCPnts import GCPnts_TangentialDeflection
from OCP.TopAbs import TopAbs_EDGE, TopAbs_FACE, TopAbs_REVERSED, TopAbs_VERTEX
from OCP.TopExp import TopExp, TopExp_Explorer
from OCP.TopLoc import TopLoc_Location
from OCP.TopoDS import TopoDS, TopoDS_Shape
from OCP.collections import IndexedMap_TopoDS_Shape_TopTools_ShapeMapHasher as IndexedMap
from OCP.gp import gp_Vec

from . import recipes
from .ops import face_normal_at_edge, planar_normal, solids_of
from .splitwalls import split_centre
from .topology import Topology

ANGULAR_DEFLECTION = 0.5  # radians


@dataclass
class Mesh:
    positions: np.ndarray  # float32, (n, 3)
    normals: np.ndarray  # float32, (n, 3)
    indices: np.ndarray  # uint32, (m * 3,)
    edge_positions: np.ndarray  # float32, (k, 3), consecutive pairs form segments
    # Per face: id, first index into `indices`, index count, planar normal or None, centroid
    faces: list[dict] = field(default_factory=list)
    # Per edge: id, first vertex into `edge_positions`, vertex count, and `centre` for a circle or ellipse (arcs too)
    edges: list[dict] = field(default_factory=list)
    # Per vertex: id and position
    vertices: list[dict] = field(default_factory=list)
    centres: list[dict] = field(default_factory=list)  # hole and boss centres: {"face": id, "position": [x, y, z], "axis": [x, y, z], "length": axis length}
    bodies: list[dict] = field(default_factory=list)  # per solid: id, name, solid number, bounds
    bounds: list[float] = field(default_factory=list)  # xmin, ymin, zmin, xmax, ymax, zmax


def _edge_centre(edge) -> list[float] | None:
    """The centre of a circular or elliptical edge (a full curve or an arc), else None. A hole cut at an angle has an
    elliptical mouth whose centre is where the hole's axis meets the face."""
    from OCP.BRepAdaptor import BRepAdaptor_Curve
    from OCP.GeomAbs import GeomAbs_Circle, GeomAbs_Ellipse

    try:
        curve = BRepAdaptor_Curve(edge)
        kind = curve.GetType()
        if kind == GeomAbs_Circle:
            p = curve.Circle().Location()
        elif kind == GeomAbs_Ellipse:
            p = curve.Ellipse().Location()
        else:
            return None
    except Exception:  # a degenerate edge has no curve
        return None
    return [p.X(), p.Y(), p.Z()]


def bounds(shape: TopoDS_Shape) -> list[float]:
    box = Bnd_Box()
    BRepBndLib.Add_s(shape, box)
    if box.IsVoid():  # an empty model (the last body was deleted) has no extent
        return [0.0] * 6
    low, high = box.CornerMin(), box.CornerMax()
    return [low.X(), low.Y(), low.Z(), high.X(), high.Y(), high.Z()]


def linear_deflection(shape: TopoDS_Shape) -> float:
    xmin, ymin, zmin, xmax, ymax, zmax = bounds(shape)
    diagonal = ((xmax - xmin) ** 2 + (ymax - ymin) ** 2 + (zmax - zmin) ** 2) ** 0.5
    # Quantized to a power-of-two step so a preview that nudges the bounding
    # box keeps the deflection, and faces meshed earlier are reused as-is.
    raw = max(diagonal * 0.001, 1e-3)
    return 2.0 ** math.ceil(math.log2(raw))



def _join(parts: list[np.ndarray], dtype, shape) -> np.ndarray:
    if not parts:
        return np.empty(0 if len(shape) == 1 else (0, shape[1]), dtype=dtype)
    return np.concatenate(parts).astype(dtype, copy=False)


# Display data of unchanged faces and edges is reused across tessellations.
# Keys wrap the OCCT shape: equality and hash take the underlying TShape, the
# location and the orientation into account, so a face that an
# edit left alone (or that was only moved, which changes its location) hits,
# and anything rebuilt misses. Entries hold the shape, which keeps its TShape
# alive so a key can never be reused by a different face. Offsets, ids and
# ranges are never stored: they are rebuilt on every call.
CACHE_LIMIT = 400_000  # approximate triangle + edge segment count kept


_MISSING = object()


class _Key:
    """Dictionary key for shapes: same TShape, location and orientation (the Python wrappers compare by identity)."""

    __slots__ = ("shapes", "extra", "_hash")

    def __init__(self, shapes, *extra):
        self.shapes = shapes if isinstance(shapes, tuple) else (shapes,)
        self.extra = extra
        self._hash = hash((tuple(hash(x) for x in self.shapes), extra))

    def __hash__(self):
        return self._hash

    def __eq__(self, other):
        return self.extra == other.extra and len(self.shapes) == len(other.shapes) and all(a.IsEqual(b) for a, b in zip(self.shapes, other.shapes))


class _Cache:
    def __init__(self):
        self.entries: dict = {}
        self.weight = 0
        self.hits = 0
        self.misses = 0

    def get(self, key, allow_none=False):
        entry = self.entries.get(key)
        if entry is None:
            self.misses += 1
            return _MISSING if allow_none else None
        self.hits += 1
        self.entries[key] = self.entries.pop(key)  # most recently used goes last
        return entry[0]

    def put(self, key, value, weight: int):
        self.entries[key] = (value, weight)
        self.weight += weight
        while self.weight > CACHE_LIMIT and len(self.entries) > 1:
            self.weight -= self.entries.pop(next(iter(self.entries)))[1]

    def clear(self):
        self.entries.clear()
        self.weight = 0
        self.hits = self.misses = 0


display_cache = _Cache()


def _face_display(face, deflection: float):
    """Everything the mesh needs from one face except offsets: arrays, centroid, planar normal and hole centre."""
    triangulation = BRep_Tool.Triangulation_s(face, TopLoc_Location())
    state = None if triangulation is None else triangulation.Deflection()
    key = _Key(face, "f", deflection, state)
    cached = display_cache.get(key)
    if cached is not None:
        return cached
    from .measure import hole_centre

    data = _face_arrays(face)
    normal = planar_normal(face)
    centre = None
    point = hole_centre(face)
    if point is not None:
        from OCP.BRepAdaptor import BRepAdaptor_Surface
        from OCP.BRepTools import BRepTools

        axis = BRepAdaptor_Surface(face).Cylinder().Axis().Direction()
        _, _, v0, v1 = BRepTools.UVBounds_s(face)
        centre = ([point.X(), point.Y(), point.Z()], [axis.X(), axis.Y(), axis.Z()], v1 - v0)
    value = (data, [normal.X(), normal.Y(), normal.Z()] if normal is not None else None, centre)
    display_cache.put(key, value, 1 + (data[2].size // 3 if data is not None else 0))
    return value


def _edge_faces(topology) -> dict[int, list]:
    """Faces next to each edge id, from one pass over the faces (iterating the ancestor map's lists is far slower)."""
    table: dict[int, list] = {}
    for face_id, face in topology.faces():
        explorer = TopExp_Explorer(face, TopAbs_EDGE)
        while explorer.More():
            edge_id = topology.edge_id(explorer.Current())
            if edge_id is not None:
                faces = table.setdefault(edge_id, [])
                if not faces or faces[-1] is not face:  # a seam edge shows twice in its face
                    faces.append(face)
            explorer.Next()
    return table


def _edge_normal(edge, faces):
    """Drag direction of an edge (see ops.edge_outward_normal); depends on the edge and the faces next to it, so those form the key."""
    key = _Key((edge,) + tuple(faces), "n")
    cached = display_cache.get(key, True)
    if cached is not _MISSING:
        return None if cached is None else list(cached)
    total = gp_Vec(0, 0, 0)
    for face in faces:
        normal = face_normal_at_edge(face, edge)
        if normal is not None:
            total.Add(gp_Vec(normal))
    value = None
    if total.Magnitude() >= 1e-6:
        total.Normalize()
        value = [total.X(), total.Y(), total.Z()]
    display_cache.put(key, value, 1)
    return None if value is None else list(value)


def _edge_points(edge, deflection: float) -> np.ndarray:
    """Segment endpoints (consecutive pairs) of one edge."""
    key = _Key(edge, "e", deflection)
    cached = display_cache.get(key)
    if cached is not None:
        return cached
    out: list[tuple[float, float, float]] = []
    if not BRep_Tool.Degenerated_s(edge):
        curve = BRepAdaptor_Curve(edge)
        sampler = GCPnts_TangentialDeflection(curve, ANGULAR_DEFLECTION, deflection)
        points = [sampler.Value(i) for i in range(1, sampler.NbPoints() + 1)]
        for p0, p1 in zip(points, points[1:]):
            out.append((p0.X(), p0.Y(), p0.Z()))
            out.append((p1.X(), p1.Y(), p1.Z()))
    array = np.asarray(out, dtype=np.float32).reshape(-1, 3)
    display_cache.put(key, array, 1 + len(array) // 2)
    return array


def _face_arrays(face):
    """Positions, normals, local indices and centroid of a meshed face."""
    location = TopLoc_Location()
    triangulation = BRep_Tool.Triangulation_s(face, location)
    if triangulation is None:
        return None
    if not triangulation.HasNormals():
        triangulation.ComputeNormals()
    transform = None if location.IsIdentity() else location.Transformation()
    reversed_face = face.Orientation() == TopAbs_REVERSED
    node_count = triangulation.NbNodes()
    pos = np.empty((node_count, 3), dtype=np.float32)
    nrm = np.empty((node_count, 3), dtype=np.float32)
    for i in range(node_count):
        p = triangulation.Node(i + 1)
        n = triangulation.Normal(i + 1)
        if transform is not None:
            p = p.Transformed(transform)
            n = n.Transformed(transform)
        if reversed_face:
            n = n.Reversed()
        pos[i] = (p.X(), p.Y(), p.Z())
        nrm[i] = (n.X(), n.Y(), n.Z())
    tri_count = triangulation.NbTriangles()
    idx = np.empty((tri_count, 3), dtype=np.uint32)
    for i in range(tri_count):
        a, b, c = triangulation.Triangle(i + 1).Get()
        idx[i] = (a - 1, c - 1, b - 1) if reversed_face else (a - 1, b - 1, c - 1)
    centroid = pos.mean(axis=0).tolist() if node_count else None
    return pos, nrm, idx.reshape(-1), centroid


def _needs_mesh(solid, deflection: float) -> bool:
    """True when a face of the solid has no triangulation at this deflection (a changed or new face)."""
    explorer = TopExp_Explorer(solid, TopAbs_FACE)
    while explorer.More():
        triangulation = BRep_Tool.Triangulation_s(TopoDS.Face(explorer.Current()), TopLoc_Location())
        if triangulation is None or triangulation.Deflection() > deflection * 1.0000001:
            return True
        explorer.Next()
    return False


def _solid_indices(topology: Topology) -> tuple[dict, dict, dict]:
    """Solid number of each face, edge and vertex id (shared sub-shapes keep the first solid).

    Ids are positions in indexed maps filled in traversal order, so a solid owns the ids its sub-shapes add to a
    running map: one map pass per solid instead of an id lookup per sub-shape. Falls back to the lookup when the
    model holds shapes outside any solid (their ids would shift the ranges)."""
    maps = (IndexedMap(), IndexedMap(), IndexedMap())
    kinds = (TopAbs_FACE, TopAbs_EDGE, TopAbs_VERTEX)
    owner = ({}, {}, {})
    number = 0
    for solid in solids_of(topology.shape):
        for table, indexed, kind in zip(owner, maps, kinds):
            before = indexed.Extent()
            TopExp.MapShapes_s(solid, kind, indexed)
            table.update(dict.fromkeys(range(before, indexed.Extent()), number))
        number += 1
    if (maps[0].Extent(), maps[1].Extent(), maps[2].Extent()) != (topology.face_count, topology.edge_count, topology.vertex_count):
        return _solid_indices_by_lookup(topology)
    return owner


def _solid_indices_by_lookup(topology: Topology) -> tuple[dict, dict, dict]:
    """Reference version of `_solid_indices`: looks up the id of every sub-shape of every solid."""
    owner = ({}, {}, {})
    lookups = (topology.face_id, topology.edge_id, topology.vertex_id)
    kinds = (TopAbs_FACE, TopAbs_EDGE, TopAbs_VERTEX)
    number = 0
    for solid in solids_of(topology.shape):
        for table, lookup, kind in zip(owner, lookups, kinds):
            sub = TopExp_Explorer(solid, kind)
            while sub.More():
                sub_id = lookup(sub.Current())
                if sub_id is not None:
                    table.setdefault(sub_id, number)
                sub.Next()
        number += 1
    return owner


def tessellate(topology: Topology, preview: bool = False) -> Mesh:
    """Mesh a topology. A preview skips the per-edge drag directions (most of the cost) since nothing is dragged on it."""
    shape = topology.shape
    face_solid, edge_solid, vertex_solid = _solid_indices(topology)
    solid_shapes = solids_of(shape)
    owners = topology.bodies.bodies
    body_of = lambda table, i: owners[table[i]].id if i in table and table[i] < len(owners) else None  # noqa: E731
    deflection = linear_deflection(shape)
    # Faces unchanged from a previous shape keep their triangulation, so
    # re-meshing after an operation only meshes the faces that changed.
    for solid in solid_shapes:
        if _needs_mesh(solid, deflection):
            BRepMesh_IncrementalMesh(solid, deflection, False, ANGULAR_DEFLECTION, True)

    positions: list[np.ndarray] = []
    normals: list[np.ndarray] = []
    indices: list[np.ndarray] = []
    faces = []
    centres = []
    base = 0
    index_count = 0

    for face_id, face in topology.faces():
        data, normal, centre = _face_display(face, deflection)
        if centre is None:
            centre = split_centre(topology, face_id)  # a hole wall split into several faces: one centre, on its first face
        start = index_count
        centroid = None
        if data is not None:
            pos, nrm, idx, centroid = data
            positions.append(pos)
            normals.append(nrm)
            indices.append(idx + np.uint32(base))
            base += len(pos)
            index_count += idx.size
        if centre is not None:
            centres.append({"face": face_id, "position": list(centre[0]), "axis": list(centre[1]), "length": centre[2]})
        faces.append(
            {
                "id": face_id,
                "start": start,
                "count": index_count - start,
                "normal": None if normal is None else list(normal),
                "centroid": centroid,
                "solid": face_solid.get(face_id, 0),
                "body": body_of(face_solid, face_id),
            }
        )

    adjacent = {} if preview else _edge_faces(topology)
    edge_parts: list[np.ndarray] = []
    edge_total = 0
    edges = []
    for edge_id, edge in topology.edges():
        start = edge_total
        points = _edge_points(edge, deflection)
        edge_parts.append(points)
        edge_total += len(points)
        edges.append(
            {
                "id": edge_id,
                "start": start,
                "count": edge_total - start,
                "normal": None if preview else _edge_normal(edge, adjacent.get(edge_id, ())),
                "solid": edge_solid.get(edge_id, 0),
                "body": body_of(edge_solid, edge_id),
                "centre": _edge_centre(edge),
            }
        )

    vertices = []
    for vertex_id, vertex in topology.vertices():
        p = BRep_Tool.Pnt_s(vertex)
        vertices.append({"id": vertex_id, "position": [p.X(), p.Y(), p.Z()], "solid": vertex_solid.get(vertex_id, 0), "body": body_of(vertex_solid, vertex_id)})

    return Mesh(
        positions=_join(positions, np.float32, (-1, 3)),
        normals=_join(normals, np.float32, (-1, 3)),
        indices=_join(indices, np.uint32, (-1,)),
        edge_positions=_join(edge_parts, np.float32, (-1, 3)),
        faces=faces,
        edges=edges,
        vertices=vertices,
        centres=centres,
        bodies=[{"id": b.id, "name": b.name, "solid": n, "bounds": bounds(solid_shapes[n]), "material": b.material, **recipes.info(b)} for n, b in enumerate(owners) if n < len(solid_shapes)],
        bounds=bounds(shape),
    )

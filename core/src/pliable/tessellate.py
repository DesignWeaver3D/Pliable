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
from OCP.TopAbs import TopAbs_EDGE, TopAbs_FACE, TopAbs_REVERSED, TopAbs_SOLID, TopAbs_VERTEX
from OCP.TopExp import TopExp_Explorer
from OCP.TopLoc import TopLoc_Location
from OCP.TopoDS import TopoDS_Shape

from .ops import edge_outward_normal, planar_normal
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
    # Per edge: id, first vertex into `edge_positions`, vertex count
    edges: list[dict] = field(default_factory=list)
    # Per vertex: id and position
    vertices: list[dict] = field(default_factory=list)
    centres: list[dict] = field(default_factory=list)  # hole and boss centres: {"face": id, "position": [x, y, z]}
    bounds: list[float] = field(default_factory=list)  # xmin, ymin, zmin, xmax, ymax, zmax


def bounds(shape: TopoDS_Shape) -> list[float]:
    box = Bnd_Box()
    BRepBndLib.Add_s(shape, box)
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
        return np.empty(shape if len(shape) == 1 else (0, shape[1]), dtype=dtype)
    return np.concatenate(parts).astype(dtype, copy=False)


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


def _solid_indices(topology: Topology) -> tuple[dict, dict, dict]:
    """Solid number of each face, edge and vertex id (shared sub-shapes keep the first solid)."""
    owner = ({}, {}, {})
    lookups = (topology.face_id, topology.edge_id, topology.vertex_id)
    kinds = (TopAbs_FACE, TopAbs_EDGE, TopAbs_VERTEX)
    solids = TopExp_Explorer(topology.shape, TopAbs_SOLID)
    number = 0
    while solids.More():
        for table, lookup, kind in zip(owner, lookups, kinds):
            sub = TopExp_Explorer(solids.Current(), kind)
            while sub.More():
                sub_id = lookup(sub.Current())
                if sub_id is not None:
                    table.setdefault(sub_id, number)
                sub.Next()
        number += 1
        solids.Next()
    return owner


def tessellate(topology: Topology) -> Mesh:
    shape = topology.shape
    face_solid, edge_solid, vertex_solid = _solid_indices(topology)
    deflection = linear_deflection(shape)
    # Faces unchanged from a previous shape keep their triangulation, so
    # re-meshing after an operation only meshes the faces that changed.
    BRepMesh_IncrementalMesh(shape, deflection, False, ANGULAR_DEFLECTION, True)

    positions: list[np.ndarray] = []
    normals: list[np.ndarray] = []
    indices: list[np.ndarray] = []
    faces = []
    base = 0
    index_count = 0

    for face_id, face in topology.faces():
        data = _face_arrays(face)
        start = index_count
        centroid = None
        if data is not None:
            pos, nrm, idx, centroid = data
            positions.append(pos)
            normals.append(nrm)
            indices.append(idx + np.uint32(base))
            base += len(pos)
            index_count += idx.size
        normal = planar_normal(face)
        faces.append(
            {
                "id": face_id,
                "start": start,
                "count": index_count - start,
                "normal": [normal.X(), normal.Y(), normal.Z()] if normal is not None else None,
                "centroid": centroid,
                "solid": face_solid.get(face_id, 0),
            }
        )

    edge_positions: list[tuple[float, float, float]] = []
    edges = []
    for edge_id, edge in topology.edges():
        start = len(edge_positions)
        if not BRep_Tool.Degenerated_s(edge):
            curve = BRepAdaptor_Curve(edge)
            sampler = GCPnts_TangentialDeflection(curve, ANGULAR_DEFLECTION, deflection)
            points = [sampler.Value(i) for i in range(1, sampler.NbPoints() + 1)]
            for p0, p1 in zip(points, points[1:]):
                edge_positions.append((p0.X(), p0.Y(), p0.Z()))
                edge_positions.append((p1.X(), p1.Y(), p1.Z()))
        edges.append(
            {
                "id": edge_id,
                "start": start,
                "count": len(edge_positions) - start,
                "normal": edge_outward_normal(topology, edge),
                "solid": edge_solid.get(edge_id, 0),
            }
        )

    vertices = []
    for vertex_id, vertex in topology.vertices():
        p = BRep_Tool.Pnt_s(vertex)
        vertices.append({"id": vertex_id, "position": [p.X(), p.Y(), p.Z()], "solid": vertex_solid.get(vertex_id, 0)})

    from .measure import hole_centre

    centres = []
    for face_id, face in topology.faces():
        centre = hole_centre(face)
        if centre is not None:
            from OCP.BRepAdaptor import BRepAdaptor_Surface

            axis = BRepAdaptor_Surface(face).Cylinder().Axis().Direction()
            centres.append({"face": face_id, "position": [centre.X(), centre.Y(), centre.Z()], "axis": [axis.X(), axis.Y(), axis.Z()]})

    return Mesh(
        positions=_join(positions, np.float32, (-1, 3)),
        normals=_join(normals, np.float32, (-1, 3)),
        indices=_join(indices, np.uint32, (-1,)),
        edge_positions=np.asarray(edge_positions, dtype=np.float32).reshape(-1, 3),
        faces=faces,
        edges=edges,
        vertices=vertices,
        centres=centres,
        bounds=bounds(shape),
    )

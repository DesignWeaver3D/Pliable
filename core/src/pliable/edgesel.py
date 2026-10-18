"""Edge selection helpers: the edges around a face, its boundary loops, and the loop two edges share."""

import math

from OCP.TopAbs import TopAbs_EDGE, TopAbs_VERTEX, TopAbs_WIRE
from OCP.TopExp import TopExp_Explorer
from OCP.TopoDS import TopoDS

from .ops import OperationError
from .topology import Topology


def _edge_ids(topology: Topology, shape) -> list[int]:
    explorer, ids = TopExp_Explorer(shape, TopAbs_EDGE), []
    while explorer.More():
        i = topology.edge_id(explorer.Current())
        if i is not None and i not in ids:
            ids.append(i)
        explorer.Next()
    return ids


def face_loops(topology: Topology, face_id: int) -> list[list[int]]:
    """The edge ids of each boundary loop of a face: the outer loop first, then any hole loops."""
    face = topology.face(face_id)
    explorer, loops = TopExp_Explorer(face, TopAbs_WIRE), []
    while explorer.More():
        loops.append(_edge_ids(topology, explorer.Current()))
        explorer.Next()
    return loops


def face_edges(topology: Topology, face_id: int) -> list[int]:
    return _edge_ids(topology, topology.face(face_id))


def shared_loop(topology: Topology, first: int, second: int) -> list[int]:
    """The boundary loop of a face that both edges border (the one holding `second` if there are several)."""
    if first == second:
        raise OperationError("Select two different edges")
    faces_a = {topology.face_id(f) for f in topology.edge_faces(topology.edge(first))}
    faces_b = [topology.face_id(f) for f in topology.edge_faces(topology.edge(second))]
    shared = [f for f in faces_b if f in faces_a]
    if not shared:
        raise OperationError("These two edges do not border a common face")
    best: list[int] | None = None
    for face_id in shared:
        for loop in face_loops(topology, face_id):
            if second in loop:
                if first in loop:
                    return loop
                best = best or loop
    return best or []


def edge_loops(topology: Topology, edge_id: int) -> list[int]:
    """The boundary loops that run through the edge, one per face beside it (loops follow shared faces, not angles)."""
    out: list[int] = []
    for face in topology.edge_faces(topology.edge(edge_id)):
        for loop in face_loops(topology, topology.face_id(face)):
            if edge_id in loop:
                out.extend(e for e in loop if e not in out)
    return out


def _vertex_edges(topology: Topology) -> dict[int, list[int]]:
    at_vertex: dict[int, list[int]] = {}
    for i, edge in topology.edges():
        explorer, seen = TopExp_Explorer(edge, TopAbs_VERTEX), set()
        while explorer.More():
            v = topology.vertex_id(TopoDS.Vertex(explorer.Current()))
            if v is not None and v not in seen:
                seen.add(v)
                at_vertex.setdefault(v, []).append(i)
            explorer.Next()
    return at_vertex


def _edge_vertices(topology: Topology, edge_id: int) -> set[int]:
    explorer, found = TopExp_Explorer(topology.edge(edge_id), TopAbs_VERTEX), set()
    while explorer.More():
        v = topology.vertex_id(TopoDS.Vertex(explorer.Current()))
        if v is not None:
            found.add(v)
        explorer.Next()
    return found


def region_boundary(topology: Topology, face_ids: list[int]) -> list[int]:
    """The outline of a set of faces: edges that border exactly one of them."""
    count: dict[int, int] = {}
    for f in face_ids:
        for e in face_edges(topology, f):
            count[e] = count.get(e, 0) + 1
    return [e for e, n in count.items() if n == 1]


def edge_ring(topology: Topology, edge_id: int) -> list[int]:
    """The ring of edges through `edge_id`: from each four-sided face the edge opposite the current one, repeated
    until the ring closes or reaches a face that is not four-sided."""
    ring, frontier = {edge_id}, [edge_id]
    while frontier:
        current = frontier.pop()
        here = _edge_vertices(topology, current)
        for face in topology.edge_faces(topology.edge(current)):
            fid = topology.face_id(face)
            loops = face_loops(topology, fid)
            if len(loops) != 1 or current not in loops[0]:
                continue
            if len(loops[0]) == 4:
                opposite = [o for o in loops[0] if o != current and not (_edge_vertices(topology, o) & here)]
            else:
                # A face with rounded corners or more sides: the parallel straight edge farthest from this one
                # (a rounded rectangle still has an opposite side; short steps nearby are ignored).
                direction = _line_direction(topology, current)
                opposite = []
                if direction is not None:
                    here_mid = _midpoint(topology, current)
                    best = 0.0
                    for o in loops[0]:
                        other_dir = _line_direction(topology, o)
                        if o != current and other_dir and not (_edge_vertices(topology, o) & here) and abs(sum(a * b for a, b in zip(direction, other_dir))) > 0.999:
                            far = math.dist(here_mid, _midpoint(topology, o))
                            if far > best + 1e-9:
                                best, opposite = far, [o]
            for other in opposite:
                if other not in ring:
                    ring.add(other)
                    frontier.append(other)
    return sorted(ring)


def _midpoint(topology: Topology, edge_id: int) -> tuple[float, float, float]:
    from OCP.BRepAdaptor import BRepAdaptor_Curve

    curve = BRepAdaptor_Curve(topology.edge(edge_id))
    p = curve.Value((curve.FirstParameter() + curve.LastParameter()) / 2)
    return (p.X(), p.Y(), p.Z())


def _line_direction(topology: Topology, edge_id: int) -> tuple[float, float, float] | None:
    """Unit direction of a straight edge, or None for a curved one."""
    from OCP.BRepAdaptor import BRepAdaptor_Curve
    from OCP.GeomAbs import GeomAbs_Line

    curve = BRepAdaptor_Curve(topology.edge(edge_id))
    if curve.GetType() != GeomAbs_Line:
        return None
    d = curve.Line().Direction()
    return (d.X(), d.Y(), d.Z())


def edge_angle(topology: Topology, edge_id: int) -> float | None:
    """The angle in degrees between the outward normals of the two faces at an edge (0 = smooth, 90 = a box corner),
    or None for an edge that does not have two different faces."""
    from OCP.BRep import BRep_Tool
    from OCP.BRepGProp import BRepGProp_Face
    from OCP.gp import gp_Pnt, gp_Vec

    edge = topology.edge(edge_id)
    faces = topology.edge_faces(edge)
    if len(faces) != 2:
        return None
    normals = []
    for face in faces:
        curve = BRep_Tool.CurveOnSurface_s(edge, face, 0.0, 0.0)
        first, last = BRep_Tool.Range_s(edge, face)
        uv = curve.Value((first + last) / 2)
        point, normal = gp_Pnt(), gp_Vec()
        BRepGProp_Face(face).Normal(uv.X(), uv.Y(), point, normal)
        normals.append(normal)
    if normals[0].Magnitude() < 1e-12 or normals[1].Magnitude() < 1e-12:
        return None
    return math.degrees(normals[0].Angle(normals[1]))


def sharp_edges(topology: Topology, edge_id: int, min_angle: float = 30.0) -> list[int]:
    """Edges connected to `edge_id` through edges whose face angle is at least `min_angle` degrees."""
    at_vertex = _vertex_edges(topology)

    def sharp(e: int) -> bool:
        a = edge_angle(topology, e)
        return a is not None and a >= min_angle

    if not sharp(edge_id):
        raise OperationError("This edge is smooth (its faces meet below the angle)")
    chosen, frontier = {edge_id}, [edge_id]
    while frontier:
        for v in _edge_vertices(topology, frontier.pop()):
            for e in at_vertex.get(v, []):
                if e not in chosen and sharp(e):
                    chosen.add(e)
                    frontier.append(e)
    return sorted(chosen)

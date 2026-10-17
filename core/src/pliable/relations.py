"""Geometric relationships of a selected face to the rest of the model.

`find_related(topology, face_id)` returns the rules that match something: coplanar faces, equal-radius round
faces (holes, bosses, fillets of the same kind and radius) and coaxial round faces. All relationship tests live
here so the sketch solver can reuse them later.
"""

import math

from OCP.BRepAdaptor import BRepAdaptor_Surface
from OCP.GeomAbs import GeomAbs_Cylinder, GeomAbs_Plane
from OCP.TopAbs import TopAbs_REVERSED

from .ops import planar_normal
from .topology import Topology

LINEAR_TOL = 1e-5
ANGULAR_TOL = 1e-6

# id -> label shown on the chip; the order is the order chips appear
RULES = {
    "coplanar": "Coplanar",
    "equal_radius": "Equal radius",
    "coaxial": "Coaxial",
}


def _plane_key(face):
    """(unit outward normal, offset along it) of a planar face, or None."""
    normal = planar_normal(face)
    if normal is None:
        return None
    origin = BRepAdaptor_Surface(face).Plane().Location()
    n = (normal.X(), normal.Y(), normal.Z())
    return n, n[0] * origin.X() + n[1] * origin.Y() + n[2] * origin.Z()


def _cylinder_key(face):
    """(radius, axis point, unit axis, is boss) of a cylindrical face, or None."""
    surface = BRepAdaptor_Surface(face)
    if surface.GetType() != GeomAbs_Cylinder:
        return None
    cylinder = surface.Cylinder()
    axis = cylinder.Axis()
    d = axis.Direction()
    p = axis.Location()
    return cylinder.Radius(), (p.X(), p.Y(), p.Z()), (d.X(), d.Y(), d.Z()), face.Orientation() != TopAbs_REVERSED


def _same_line(a, b) -> bool:
    """Two axes (point, unit direction) describe the same infinite line."""
    (pa, da), (pb, db) = a, b
    if abs(abs(sum(x * y for x, y in zip(da, db))) - 1) > ANGULAR_TOL:
        return False
    offset = [x - y for x, y in zip(pa, pb)]
    along = sum(o * d for o, d in zip(offset, da))
    return math.dist(offset, [along * d for d in da]) < LINEAR_TOL


def find_related(topology: Topology, face_id: int) -> list[dict]:
    """Rules with at least one matching face: [{"id", "label", "faces": [face ids]}] (the face itself excluded)."""
    face = topology.face(face_id)
    found: dict[str, list[int]] = {}
    plane = _plane_key(face)
    cylinder = _cylinder_key(face)
    for other_id, other in topology.faces():
        if other_id == face_id:
            continue
        if plane is not None:
            key = _plane_key(other)
            if key is not None and all(abs(a - b) < ANGULAR_TOL for a, b in zip(plane[0], key[0])) and abs(plane[1] - key[1]) < LINEAR_TOL:
                found.setdefault("coplanar", []).append(other_id)
        if cylinder is not None:
            key = _cylinder_key(other)
            if key is None:
                continue
            if abs(cylinder[0] - key[0]) < LINEAR_TOL and cylinder[3] == key[3]:
                found.setdefault("equal_radius", []).append(other_id)
            if abs(cylinder[0] - key[0]) >= LINEAR_TOL and _same_line(cylinder[1:3], key[1:3]):
                found.setdefault("coaxial", []).append(other_id)
    return [{"id": rule, "label": RULES[rule], "faces": found[rule]} for rule in RULES if rule in found]


def _end_tangent(edge, vertex_point) -> tuple[float, float, float] | None:
    """Unit tangent of an edge at the end that lies at `vertex_point`."""
    from OCP.BRepAdaptor import BRepAdaptor_Curve
    from OCP.gp import gp_Pnt, gp_Vec

    curve = BRepAdaptor_Curve(edge)
    first, last = curve.FirstParameter(), curve.LastParameter()
    end = first if curve.Value(first).Distance(vertex_point) <= curve.Value(last).Distance(vertex_point) else last
    point, tangent = gp_Pnt(), gp_Vec()
    curve.D1(end, point, tangent)
    if tangent.Magnitude() < 1e-12:
        return None
    tangent.Normalize()
    return tangent.X(), tangent.Y(), tangent.Z()


def tangent_chain(topology: Topology, edge_id: int) -> list[int]:
    """Edges reached from `edge_id` by passing through vertices where the curves continue smoothly (a rim, an
    outline), including the edge itself. Edges that merely touch at a corner are not followed."""
    from OCP.BRep import BRep_Tool
    from OCP.TopAbs import TopAbs_VERTEX
    from OCP.TopExp import TopExp_Explorer
    from OCP.TopoDS import TopoDS

    at_vertex: dict[int, list[int]] = {}
    for i, edge in topology.edges():
        explorer = TopExp_Explorer(edge, TopAbs_VERTEX)
        seen = set()
        while explorer.More():
            v = topology.vertex_id(TopoDS.Vertex(explorer.Current()))
            if v is not None and v not in seen:
                seen.add(v)
                at_vertex.setdefault(v, []).append(i)
            explorer.Next()
    chain, frontier = {edge_id}, [edge_id]
    while frontier:
        current = frontier.pop()
        explorer = TopExp_Explorer(topology.edge(current), TopAbs_VERTEX)
        while explorer.More():
            vertex = TopoDS.Vertex(explorer.Current())
            v = topology.vertex_id(vertex)
            point = BRep_Tool.Pnt_s(vertex)
            mine = _end_tangent(topology.edge(current), point)
            for other in at_vertex.get(v, []):
                if other in chain or mine is None:
                    continue
                theirs = _end_tangent(topology.edge(other), point)
                if theirs is not None and abs(sum(a * b for a, b in zip(mine, theirs))) > 1 - 1e-4:
                    chain.add(other)
                    frontier.append(other)
            explorer.Next()
    return sorted(chain)

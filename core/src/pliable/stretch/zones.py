"""The three zones of a stretch, from the selection alone.

Protected: the selected faces, edges and vertices (and everything they own), moved as one rigid piece. Rubber: the
faces that join the protected part to the rest, the only geometry that changes. Fixed: everything else.
"""

import math
from dataclasses import dataclass

from OCP.BRepAdaptor import BRepAdaptor_Curve, BRepAdaptor_Surface
from OCP.GeomAbs import GeomAbs_Circle, GeomAbs_Cylinder, GeomAbs_Line, GeomAbs_Sphere, GeomAbs_Torus

from .body import Body

HALF_ROUND = math.pi - 0.01  # a round face turning this far or more (radians) is a wall of the part, not a fillet


@dataclass
class Zones:
    body: Body
    protected_faces: set
    protected_edges: set
    protected_vertices: set
    rubber: set

    @property
    def fixed(self) -> set:
        return set(range(len(self.body.faces))) - self.protected_faces - self.rubber


def _fillet_rail(surface: BRepAdaptor_Surface, edge) -> bool:
    """True when the edge runs along the fillet (one of the two edges where it meets the faces it rounds), not across its end."""
    kind, curve = surface.GetType(), BRepAdaptor_Curve(edge)
    if kind == GeomAbs_Cylinder:
        return curve.GetType() == GeomAbs_Line and abs(surface.LastUParameter() - surface.FirstUParameter()) < HALF_ROUND
    if kind == GeomAbs_Torus:
        if curve.GetType() != GeomAbs_Circle or abs(surface.LastVParameter() - surface.FirstVParameter()) >= HALF_ROUND:  # v runs round the tube
            return False
        return abs(curve.Circle().Axis().Direction().Dot(surface.Torus().Axis().Direction())) > 1 - 1e-9
    return kind == GeomAbs_Sphere


def _rides_along(body: Body, face: int, protected: set) -> bool:
    """True for a fillet that rounds the edge of a protected face: it is tangent to that face along its length, so it
    keeps its shape and moves with it (the faces on its other side stretch instead)."""
    from ..measure import _tangent

    surface = BRepAdaptor_Surface(body.faces[face])
    if surface.GetType() not in (GeomAbs_Cylinder, GeomAbs_Torus, GeomAbs_Sphere):
        return False
    for edge in body.face_edges[face]:
        for other in body.edge_faces[edge]:
            if other in protected and _fillet_rail(surface, body.edges[edge]) and _tangent(body.edges[edge], body.faces[face], body.faces[other]):
                return True
    return False


def sort_zones(body: Body, faces: set, edges: set, vertices: set) -> Zones:
    """The zones for a selection given as face, edge and vertex numbers of `body`."""
    protected = set(faces)
    while True:
        own_edges = set(edges) | {e for f in protected for e in body.face_edges[f]}
        own_vertices = set(vertices) | {v for e in own_edges for v in body.edge_vertices[e]}
        rest = set(range(len(body.faces))) - protected
        # A face with every corner on the protected part can only move with it.
        whole = {f for f in rest if body.face_vertices[f] and body.face_vertices[f] <= own_vertices}
        rubber = {f for f in rest - whole if body.face_vertices[f] & own_vertices}
        grown = whole | {f for f in rubber if _rides_along(body, f, protected | whole)}
        if not grown:
            return Zones(body, protected, own_edges, own_vertices, rubber)
        protected |= grown

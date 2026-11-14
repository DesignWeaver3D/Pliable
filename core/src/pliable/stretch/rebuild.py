"""Putting a solid back together with new geometry under the same faces, edges and vertices.

Nothing is cut, fused or sewn: every face, edge and vertex of the old solid gets one new counterpart, in the same order
and with the same orientation, so their numbers (the ids the selection uses) are unchanged.
"""

from dataclasses import dataclass, field

from OCP.BRep import BRep_Builder, BRep_Tool
from OCP.TopAbs import TopAbs_FORWARD, TopAbs_REVERSED, TopAbs_SHELL, TopAbs_WIRE
from OCP.TopoDS import TopoDS, TopoDS_Edge, TopoDS_Face, TopoDS_Iterator, TopoDS_Shell, TopoDS_Solid, TopoDS_Vertex, TopoDS_Wire

from ..ops import OperationError
from .body import Body

CHECKS = 48 # points along an edge where its curve is compared with the surfaces it lies on
OFF_GRID = 0.37  # they sit off the even fractions, where a fitted surface was sampled and is exact


def old_pcurves(edge, face) -> tuple:
    """The curve (or, on a seam, the two curves) an edge draws in a face's (u, v) space; (None, None) when it has none."""
    edge, face = TopoDS.Edge(edge.Oriented(TopAbs_FORWARD)), TopoDS.Face(face.Oriented(TopAbs_FORWARD))
    first = BRep_Tool.CurveOnSurface_s(edge, face, 0.0, 0.0)
    second = BRep_Tool.CurveOnSurface_s(TopoDS.Edge(edge.Reversed()), face, 0.0, 0.0) if BRep_Tool.IsClosed_s(edge, face) else None
    return first, second


def _children(shape):
    """The direct sub-shapes with the orientation the shape stores for them."""
    walk = TopoDS_Iterator(shape, False, True)
    while walk.More():
        yield walk.Value()
        walk.Next()


@dataclass
class Geometry:
    """The new geometry of a body: a point per vertex, (curve, first, last) per edge (curve None for an edge shrunk to
    a point), a surface per face, and per (edge, face) the edge's one or two curves in the face's (u, v) space."""

    points: list = field(default_factory=list)
    curves: list = field(default_factory=list)
    surfaces: list = field(default_factory=list)
    pcurves: dict = field(default_factory=dict)
    changed_edges: set = field(default_factory=set)  # edges whose curve or surfaces changed: their fit is measured again


def _deviation(geometry: Geometry, body: Body, edge: int) -> float:
    """How far an edge's curve is from the same edge drawn on each of its faces."""
    curve, first, last = geometry.curves[edge]
    worst = 0.0
    for k in range(CHECKS):
        t = first + (last - first) * (k + OFF_GRID) / CHECKS
        point = curve.Value(t)
        for face in body.edge_faces[edge]:
            for drawn in geometry.pcurves.get((edge, face), ()):
                if drawn is not None:
                    uv = drawn.Value(t)
                    worst = max(worst, point.Distance(geometry.surfaces[face].Value(uv.X(), uv.Y())))
    return worst


def unchanged(body: Body) -> Geometry:
    """The geometry the body has now."""
    geometry = Geometry(points=[BRep_Tool.Pnt_s(v) for v in body.vertices], surfaces=[BRep_Tool.Surface_s(f) for f in body.faces])
    for number, edge in enumerate(body.edges):
        if BRep_Tool.Degenerated_s(edge):
            geometry.curves.append((None, *BRep_Tool.Range_s(edge, body.faces[body.edge_faces[number][0]])))
        else:
            geometry.curves.append((BRep_Tool.Curve_s(edge, 0.0, 0.0), *BRep_Tool.Range_s(edge)))
    for face, edges in enumerate(body.face_edges):
        for edge in edges:
            geometry.pcurves[(edge, face)] = old_pcurves(body.edges[edge], body.faces[face])
    return geometry


def rebuild(body: Body, geometry: Geometry, allowed: float, drop=frozenset()):
    """The solid with the new geometry, and its faces, edges and vertices in the old order. `allowed` is the largest
    distance an edge may be off its faces; more than that is refused. Faces in `drop` are left out, with the holes
    they bound in the faces around them (an island feature such as a hole, pocket or boss), so those faces close over."""
    gone = {e for f in drop for e in body.face_edges[f]}
    builder = BRep_Builder()
    vertices, edges, faces = [], [], []
    vertex_tol = [BRep_Tool.Tolerance_s(v) for v in body.vertices]
    for number, old in enumerate(body.vertices):
        new = TopoDS_Vertex()
        builder.MakeVertex(new, geometry.points[number], vertex_tol[number])
        vertices.append(new)
    edge_tol = []
    for number, old in enumerate(body.edges):
        curve, first, last = geometry.curves[number]
        tolerance = BRep_Tool.Tolerance_s(old)
        new = TopoDS_Edge()
        if curve is None:
            builder.MakeEdge(new)
            builder.Degenerated(new, True)
        else:
            if number in geometry.changed_edges:
                off = _deviation(geometry, body, number)
                if off > allowed:
                    raise OperationError("Stretch could not make the faces meet along an edge closely enough; try a smaller move or a longer band")
                tolerance = max(tolerance, 3 * off + 1e-9)
            builder.MakeEdge(new, curve, tolerance)
        for end in _children(old.Oriented(TopAbs_FORWARD)):
            which = body.vertex_number(end)
            builder.Add(new, vertices[which].Oriented(end.Orientation()))
            if curve is not None and end.Orientation() in (TopAbs_FORWARD, TopAbs_REVERSED):
                gap = curve.Value(first if end.Orientation() == TopAbs_FORWARD else last).Distance(geometry.points[which])
                vertex_tol[which] = max(vertex_tol[which], tolerance, 1.1 * gap + 1e-9)
        edges.append(new)
        edge_tol.append(tolerance)
    for number, old in enumerate(body.faces):
        if number in drop:
            faces.append(None)
            continue
        new = TopoDS_Face()
        builder.MakeFace(new, geometry.surfaces[number], BRep_Tool.Tolerance_s(old))
        for edge in body.face_edges[number]:
            drawn = geometry.pcurves.get((edge, number))
            if drawn is None or drawn[0] is None:
                continue
            if drawn[1] is not None:
                builder.UpdateEdge(edges[edge], drawn[0], drawn[1], new, edge_tol[edge])
            else:
                builder.UpdateEdge(edges[edge], drawn[0], new, edge_tol[edge])
        for part in _children(old.Oriented(TopAbs_FORWARD)):
            if part.ShapeType() != TopAbs_WIRE:
                continue
            members = list(_children(part.Oriented(TopAbs_FORWARD)))
            if any(body.edge_number(member) in gone for member in members):
                continue
            wire = TopoDS_Wire()
            builder.MakeWire(wire)
            for member in members:
                builder.Add(wire, edges[body.edge_number(member)].Oriented(member.Orientation()))
            wire.Closed(part.Closed())
            builder.Add(new, wire.Oriented(part.Orientation()))
        builder.NaturalRestriction(new, BRep_Tool.NaturalRestriction_s(old))
        faces.append(new)
    for number, new in enumerate(edges):  # after the curves on the faces are in place, so the range covers them all
        _, first, last = geometry.curves[number]
        builder.Range(new, first, last)
    for number, new in enumerate(vertices):
        builder.UpdateVertex(new, vertex_tol[number])
    solid = TopoDS_Solid()
    builder.MakeSolid(solid)
    for part in _children(body.solid.Oriented(TopAbs_FORWARD)):
        if part.ShapeType() != TopAbs_SHELL:
            continue
        shell = TopoDS_Shell()
        builder.MakeShell(shell)
        for member in _children(part.Oriented(TopAbs_FORWARD)):
            if faces[body.face_number(member)] is not None:
                builder.Add(shell, faces[body.face_number(member)].Oriented(member.Orientation()))
        shell.Closed(part.Closed())
        builder.Add(solid, shell.Oriented(part.Orientation()))
    return solid.Oriented(body.solid.Orientation()), faces, edges, vertices

"""Move/Rotate on edges: the gizmo (two arrows square to the edge and one turn arc, with snaps square to the faces beside it) and the edge move.

In edge mode dx, dy and dz are distances along the gizmo's X (the edge itself), Y and Z, and rx turns the gizmo about the edge; ry and rz are not used."""

import math

from OCP.BRep import BRep_Builder
from OCP.BRepAdaptor import BRepAdaptor_Curve
from OCP.TopAbs import TopAbs_EDGE, TopAbs_FACE, TopAbs_VERTEX
from OCP.TopExp import TopExp
from OCP.TopoDS import TopoDS, TopoDS_Compound
from OCP.collections import IndexedMap_TopoDS_Shape_TopTools_ShapeMapHasher as ShapeIndexedMap
from OCP.gp import gp_Vec

from ..ops import MIN_DISTANCE, OperationError, OpResult, planar_normal, solids_of
from ..shared.edge_frame import base_frame, snap_angles, turned_axes
from ..shared.solids import finish
from ..tools import Handle
from .stretch import REFUSED, _shapes, _straight, shift_vertices

GIZMO_AXES = ((1.0, 0.0, 0.0), (0.0, 1.0, 0.0), (0.0, 0.0, 1.0))


def _edge_line(edge):
    """(midpoint, unit direction, length) of a straight edge."""
    curve = BRepAdaptor_Curve(edge)
    first, last = curve.FirstParameter(), curve.LastParameter()
    a, b, mid = curve.Value(first), curve.Value(last), curve.Value((first + last) / 2)
    along = gp_Vec(a, b)
    length = along.Magnitude()
    return (mid.X(), mid.Y(), mid.Z()), ((along.X() / length, along.Y() / length, along.Z() / length) if length > 1e-12 else (1.0, 0.0, 0.0)), length


def _normals(topology, edges) -> list:
    """The unit normals of the flat faces beside the edges."""
    out = []
    for edge in edges:
        for face in topology.edge_faces(edge):
            n = planar_normal(face)
            if n is not None:
                out.append((n.X(), n.Y(), n.Z()))
    return out


def edge_handles(topology, selection, values) -> list:
    """The gizmo for moving edges: two arrows square to the first edge (and each other) at the middle of the edges, and one turn arc between them
    that swings them about the edge (rx)."""
    edges = _edges(topology, selection)
    lines = [_edge_line(e) for e in edges]
    t, u, v = turned_axes(lines[0][1], values["rx"])
    shift = _shift(lines[0][1], values)
    here = tuple(sum(line[0][k] for line in lines) / len(lines) + shift[k] for k in range(3))
    out = [Handle("dy", "Move along gizmo Y", here, u, kind="move"), Handle("dz", "Move along gizmo Z", here, v, kind="move")]
    _, u0, v0 = base_frame(lines[0][1])
    theta = math.radians(45 + values["rx"])  # the arc sits between the arrows, centred 45 degrees round from the first
    radial = tuple(math.cos(theta) * u0[k] + math.sin(theta) * v0[k] for k in range(3))
    tangent = tuple(-math.sin(theta) * u0[k] + math.cos(theta) * v0[k] for k in range(3))
    radius = max(max(line[2] for line in lines) * 0.6, 8.0)
    anchor = tuple(here[k] + radius * radial[k] for k in range(3))
    out.append(Handle("rx", "Turn gizmo about the edge", anchor, tangent, scale=math.degrees(1 / radius), unit="°", axis=t, ring=(*here, radius), snaps=tuple(snap_angles(lines[0][1], _normals(topology, edges))), arc=True))
    return out


def _shift(direction, values) -> tuple:
    """The world offset of the edge: dx along it, dy and dz along the two cross axes of the gizmo (turned by rx)."""
    t, u, v = turned_axes(direction, values["rx"])
    return tuple(values["dx"] * t[k] + values["dy"] * u[k] + values["dz"] * v[k] for k in range(3))


def edge_run(topology, selection, values) -> OpResult:
    """Move the selected edges by (dx, dy, dz) along the gizmo turned by rx, ry, rz degrees, re-fitting the faces beside them."""
    edges = _edges(topology, selection)
    offset = gp_Vec(*_shift(_edge_line(edges[0])[1], values))
    if offset.Magnitude() < MIN_DISTANCE:
        return OpResult(topology.shape, [])
    solids = solids_of(topology.shape)
    body = next((s for s in solids if all(any(e.IsSame(o) for o in _shapes(s, TopAbs_EDGE)) for e in edges)), None)
    if body is None:
        raise OperationError("Select edges that all belong to one solid")
    moved = ShapeIndexedMap()
    along: dict[int, tuple] = {}  # the direction of the (first) selected edge at each moved corner, which the corner may slide along
    for edge, line in zip(edges, (_edge_line(e) for e in edges)):
        corners = ShapeIndexedMap()
        TopExp.MapShapes_s(edge, TopAbs_VERTEX, corners)
        for k in range(1, corners.Extent() + 1):
            index = moved.Add(corners.FindKey(k))
            along.setdefault(index, line[1])
    flexible = [f for e in edges for f in topology.edge_faces(e)]  # the faces beside the edges tilt; the others keep their planes
    fixed_planes = [f for f in (TopoDS.Face(x) for x in _shapes(body, TopAbs_FACE)) if not any(f.IsSame(o) for o in flexible) and planar_normal(f) is not None]
    slides = {}
    for index in range(1, moved.Extent() + 1):
        slides[index] = _slide(moved.FindKey(index), along[index], offset, fixed_planes)

    def shift(vertex):
        index = moved.FindIndex(vertex)
        return slides[index] if index else None

    try:
        changed = shift_vertices(body, moved, shift)
    except OperationError as error:
        raise OperationError(str(error).replace(REFUSED, "")) from None
    compound, builder = TopoDS_Compound(), BRep_Builder()
    builder.MakeCompound(compound)
    for solid in solids:
        builder.Add(compound, changed if solid.IsSame(body) else solid)
    return finish(compound)


def _slide(vertex, t, offset: gp_Vec, fixed_planes) -> gp_Vec:
    """Where a moved corner goes: the offset, plus a slide along the edge until it is back on every face that stays where it is."""
    slide = 0.0
    planes = [(planar_normal(f), f) for f in fixed_planes if any(v.IsSame(vertex) for v in _shapes(f, TopAbs_VERTEX))]
    for normal, _ in planes:
        n = (normal.X(), normal.Y(), normal.Z())
        along = sum(n[k] * t[k] for k in range(3))
        push = n[0] * offset.X() + n[1] * offset.Y() + n[2] * offset.Z()
        if abs(along) > 1e-6:
            slide = -push / along
            break
    result = gp_Vec(offset.X() + slide * t[0], offset.Y() + slide * t[1], offset.Z() + slide * t[2])
    for normal, _ in planes:
        if abs(normal.X() * result.X() + normal.Y() * result.Y() + normal.Z() * result.Z()) > 1e-6:
            raise OperationError("That move would pull a corner off a face that stays in place")
    return result


def _edges(topology, selection):
    edges = [topology.edge(i) for i in selection.edges]
    if selection.faces or selection.bodies:
        raise OperationError("Select edges, or bodies and faces, not both")
    if not all(_straight(e) for e in edges):
        raise OperationError("Moving edges needs straight edges")
    return edges


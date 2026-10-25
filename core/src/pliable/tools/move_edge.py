"""Move/Rotate on edges: the gizmo, its snaps and the edge move."""

import math

from OCP.BRep import BRep_Builder
from OCP.BRepAdaptor import BRepAdaptor_Curve
from OCP.TopAbs import TopAbs_EDGE, TopAbs_FACE, TopAbs_VERTEX
from OCP.TopExp import TopExp
from OCP.TopoDS import TopoDS, TopoDS_Compound
from OCP.collections import IndexedMap_TopoDS_Shape_TopTools_ShapeMapHasher as ShapeIndexedMap
from OCP.gp import gp_Vec

from ..ops import MIN_DISTANCE, OperationError, OpResult, planar_normal, solids_of
from ..shared.edge_frame import frame_axes, ring_axes, rotate_vector, snap_angles
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


def _snap_targets(topology, edges) -> list:
    """The directions the gizmo can line up with: the global axes, and for each flat face beside the edges its normal and the line across
    it from the edge."""
    targets = list(GIZMO_AXES)
    for edge in edges:
        _, t, _ = _edge_line(edge)
        targets.append(t)
        for face in topology.edge_faces(edge):
            n = planar_normal(face)
            if n is None:
                continue
            normal = (n.X(), n.Y(), n.Z())
            across = (normal[1] * t[2] - normal[2] * t[1], normal[2] * t[0] - normal[0] * t[2], normal[0] * t[1] - normal[1] * t[0])
            targets += [normal, across]
    return targets


def edge_handles(topology, selection, values) -> list:
    """The gizmo for moving edges: arrows along the gizmo's axes at the middle of the edges, and one turn ring per gizmo angle (rx, ry, rz)."""
    edges = _edges(topology, selection)
    lines = [_edge_line(e) for e in edges]
    angles = (values["rx"], values["ry"], values["rz"])
    shift = rotate_vector(angles, (values["dx"], values["dy"], values["dz"]))
    here = tuple(sum(line[0][k] for line in lines) / len(lines) + shift[k] for k in range(3))
    out = [
        Handle(name, f"Move along gizmo {label}", here, axis, kind="move")
        for (name, label), axis in zip((("dx", "X"), ("dy", "Y"), ("dz", "Z")), frame_axes(angles))
    ]
    radius = max(max(line[2] for line in lines) * 0.6, 8.0)
    targets = _snap_targets(topology, edges)
    for i, (name, axis) in enumerate(zip(("rx", "ry", "rz"), ring_axes(angles))):
        seed = (1.0, 0.0, 0.0) if abs(axis[0]) < 0.9 else (0.0, 1.0, 0.0)
        b1 = _unit(_cross(axis, seed))
        b2 = _cross(axis, b1)  # axis x b1: with b1 these turn right-handed about the axis
        theta = math.radians(45 + values[name])
        radial = tuple(math.cos(theta) * b1[k] + math.sin(theta) * b2[k] for k in range(3))
        tangent = tuple(-math.sin(theta) * b1[k] + math.cos(theta) * b2[k] for k in range(3))
        anchor = tuple(here[k] + radius * radial[k] for k in range(3))
        out.append(Handle(name, f"Turn gizmo about {'XYZ'[i]}", anchor, tangent, scale=math.degrees(1 / radius), unit="°", axis=axis, ring=(*here, radius), snaps=tuple(snap_angles(angles, i, targets)), arc=True))
    return out


def edge_run(topology, selection, values) -> OpResult:
    """Move the selected edges by (dx, dy, dz) along the gizmo turned by rx, ry, rz degrees, re-fitting the faces beside them."""
    edges = _edges(topology, selection)
    offset = gp_Vec(*rotate_vector((values["rx"], values["ry"], values["rz"]), (values["dx"], values["dy"], values["dz"])))
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


def _cross(a, b):
    return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])


def _unit(v):
    length = math.sqrt(sum(c * c for c in v))
    return tuple(c / length for c in v)

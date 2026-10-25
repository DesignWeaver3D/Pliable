"""The Move edge tool."""

import math

from OCP.BRep import BRep_Builder
from OCP.BRepAdaptor import BRepAdaptor_Curve
from OCP.TopAbs import TopAbs_EDGE, TopAbs_VERTEX
from OCP.TopExp import TopExp
from OCP.TopoDS import TopoDS_Compound
from OCP.collections import IndexedMap_TopoDS_Shape_TopTools_ShapeMapHasher as ShapeIndexedMap
from OCP.gp import gp_Vec

from ..ops import MIN_DISTANCE, OperationError, OpResult, planar_normal, solids_of
from ..shared.edge_frame import frame_axes, ring_axes, rotate_vector, snap_angles
from ..shared.solids import finish
from ..tools import Accepts, Handle, Param, register, Tool
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


@register
class MoveEdge(Tool):
    """Move the selected edges by (dx, dy, dz) measured along a gizmo that starts square to the global axes and is turned by gx, gy and gz
    degrees (about its X, then Y, then Z); the faces beside the edges are re-fitted through the moved corners."""

    id = "move_edge"
    label = "Move edge"
    description = (
        "Moves the selected edges and re-fits the faces beside them, so the shape changes. The gizmo sits at the middle of the edge, square to the global axes; "
        "drag its rings (or type degrees) to turn it, and it snaps square to the global axes and to the faces next to the edge (their normals and the lines across them). "
        "Then drag the arrows (or type distances) to move the edge along the gizmo's axes."
    )
    accepts = Accepts(edges=(1, None))
    params = [Param("dx", "length"), Param("dy", "length"), Param("dz", "length"), Param("gx", "angle"), Param("gy", "angle"), Param("gz", "angle")]
    starts_from = "selection"

    def _edges(self, topology, selection):
        edges = [topology.edge(i) for i in selection.edges]
        if not all(_straight(e) for e in edges):
            raise OperationError("Move edge needs straight edges")
        return edges

    def handles(self, topology, selection, values):
        edges = self._edges(topology, selection)
        lines = [_edge_line(e) for e in edges]
        angles = (values["gx"], values["gy"], values["gz"])
        shift = rotate_vector(angles, (values["dx"], values["dy"], values["dz"]))
        here = tuple(sum(line[0][k] for line in lines) / len(lines) + shift[k] for k in range(3))
        out = [
            Handle(name, f"Move along gizmo {label}", here, axis, kind="move")
            for (name, label), axis in zip((("dx", "X"), ("dy", "Y"), ("dz", "Z")), frame_axes(angles))
        ]
        radius = max(max(line[2] for line in lines) * 0.6, 8.0)
        targets = _snap_targets(topology, edges)
        for i, (name, axis) in enumerate(zip(("gx", "gy", "gz"), ring_axes(angles))):
            seed = (1.0, 0.0, 0.0) if abs(axis[0]) < 0.9 else (0.0, 1.0, 0.0)
            b1 = _unit(_cross(axis, seed))
            b2 = _cross(axis, b1)  # axis x b1: with b1 these turn right-handed about the axis
            theta = math.radians(45 + values[name])
            radial = tuple(math.cos(theta) * b1[k] + math.sin(theta) * b2[k] for k in range(3))
            tangent = tuple(-math.sin(theta) * b1[k] + math.cos(theta) * b2[k] for k in range(3))
            anchor = tuple(here[k] + radius * radial[k] for k in range(3))
            out.append(Handle(name, f"Turn gizmo about {'XYZ'[i]}", anchor, tangent, scale=math.degrees(1 / radius), unit="°", axis=axis, ring=(*here, radius), snaps=tuple(snap_angles(angles, i, targets))))
        return out

    def run(self, topology, selection, values, preview):
        edges = self._edges(topology, selection)
        offset = gp_Vec(*rotate_vector((values["gx"], values["gy"], values["gz"]), (values["dx"], values["dy"], values["dz"])))
        if offset.Magnitude() < MIN_DISTANCE:
            return OpResult(topology.shape, [])
        solids = solids_of(topology.shape)
        body = next((s for s in solids if all(any(e.IsSame(o) for o in _shapes(s, TopAbs_EDGE)) for e in edges)), None)
        if body is None:
            raise OperationError("Select edges that all belong to one solid")
        moved = ShapeIndexedMap()
        for edge in edges:
            corners = ShapeIndexedMap()
            TopExp.MapShapes_s(edge, TopAbs_VERTEX, corners)
            for k in range(1, corners.Extent() + 1):
                moved.Add(corners.FindKey(k))
        try:
            changed = shift_vertices(body, moved, offset)
        except OperationError as error:
            raise OperationError(str(error).replace(REFUSED, "")) from None
        compound, builder = TopoDS_Compound(), BRep_Builder()
        builder.MakeCompound(compound)
        for solid in solids:
            builder.Add(compound, changed if solid.IsSame(body) else solid)
        return finish(compound)


def _cross(a, b):
    return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])


def _unit(v):
    length = math.sqrt(sum(c * c for c in v))
    return tuple(c / length for c in v)

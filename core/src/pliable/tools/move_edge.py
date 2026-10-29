"""Move/Rotate on edges: the gizmo (two arrows square to the edge and one turn arc, with snaps square to the faces beside it) and the edge move.

In edge mode dx, dy and dz are the world move of the edge, and rx only turns the gizmo's arrows about the edge (it never moves the edge); ry and rz are not used."""

import math

from OCP.BRep import BRep_Builder, BRep_Tool
from OCP.BRepAdaptor import BRepAdaptor_Curve
from OCP.TopAbs import TopAbs_EDGE, TopAbs_FACE, TopAbs_VERTEX
from OCP.TopExp import TopExp
from OCP.TopoDS import TopoDS, TopoDS_Compound
from OCP.collections import IndexedMap_TopoDS_Shape_TopTools_ShapeMapHasher as ShapeIndexedMap
from OCP.gp import gp_Vec

from ..ops import MIN_DISTANCE, OperationError, OpResult, planar_normal, solids_of
from ..shared.edge_frame import base_frame, snap_angles, turned_axes
from ..shared.solids import finish
from ..topology import Topology
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
    that swings them about the edge (rx). Turning the arrows changes only where they point, never the move already made."""
    original = [_edge_line(e) for e in _edges(topology, selection)]
    now, edges = _where_now(topology, selection, values)
    lines = [_edge_line(e) for e in edges]
    t, u, v = turned_axes(original[0][1], values["rx"])  # the axes come from the edge as first selected; the faces and the place from where it is now
    here = tuple(sum(line[0][k] for line in lines) / len(lines) for k in range(3))
    out = [_arrow("Move along gizmo Y", here, u), _arrow("Move along gizmo Z", here, v)]
    _, u0, v0 = base_frame(original[0][1])
    theta = math.radians(45 + values["rx"])  # the arc sits between the arrows, centered 45 degrees round from the first
    radial = tuple(math.cos(theta) * u0[k] + math.sin(theta) * v0[k] for k in range(3))
    tangent = tuple(-math.sin(theta) * u0[k] + math.cos(theta) * v0[k] for k in range(3))
    radius = max(max(line[2] for line in lines) * 0.6, 8.0)
    anchor = tuple(here[k] + radius * radial[k] for k in range(3))
    snaps = snap_angles(original[0][1], _normals(now, edges))
    out.append(Handle("rx", "Turn gizmo about the edge", anchor, tangent, scale=math.degrees(1 / radius), unit="°", axis=t, ring=(*here, radius), snaps=tuple(a for a, _ in snaps), snap_names=tuple(n for _, n in snaps), arc=True))
    return out


def _arrow(label, here, direction) -> Handle:
    """A move arrow along `direction`: dragging it changes the world move (dx, dy, dz) along that line, the parameter it is declared on being the one the direction is most along."""
    names = ("dx", "dy", "dz")
    main = max(range(3), key=lambda k: abs(direction[k]))
    links = tuple((names[k], direction[k]) for k in range(3) if k != main)
    return Handle(names[main], label, here, direction, scale=direction[main], kind="move", links=links, along=True, turned_by="rx")


_last_move: dict = {}  # the latest move, so the handles built in the same request reuse it instead of redoing it


def _move(topology, selection, values):
    """(result, ends): the model with the selected edges moved, and where each edge's two end points now are (the same for the same request)."""
    key = (tuple(selection.edges), values["dx"], values["dy"], values["dz"])
    if _last_move.get("shape") is topology.shape and _last_move.get("key") == key:
        return _last_move["result"], _last_move["ends"]
    edges = _edges(topology, selection)
    offset = gp_Vec(values["dx"], values["dy"], values["dz"])
    if offset.Magnitude() < MIN_DISTANCE:
        return OpResult(topology.shape, []), None
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
    ends = []
    for edge in edges:
        curve = BRepAdaptor_Curve(edge)
        points = [curve.Value(curve.FirstParameter()), curve.Value(curve.LastParameter())]
        ends.append(tuple(_nudged(p, moved, slides) for p in points))
    result = finish(compound)
    _last_move.update(shape=topology.shape, key=key, result=result, ends=ends)
    return result, ends


def _nudged(point, moved, slides):
    """A corner of an edge where it ends up: the point plus the slide of the moved corner that sits there."""
    for index in range(1, moved.Extent() + 1):
        here = BRep_Tool.Pnt_s(TopoDS.Vertex(moved.FindKey(index)))
        if here.Distance(point) < 1e-7:
            return (point.X() + slides[index].X(), point.Y() + slides[index].Y(), point.Z() + slides[index].Z())
    return (point.X(), point.Y(), point.Z())


def edge_run(topology, selection, values) -> OpResult:
    """Move the selected edges by (dx, dy, dz), their corners sliding along faces that stay, re-fitting the faces beside them."""
    return _move(topology, selection, values)[0]


def _where_now(topology, selection, values):
    """(topology, edges) of the model as it stands with the move made, so the gizmo reads the faces beside the edges as they are now; the
    given model and its edges when nothing has moved or an edge cannot be found again."""
    edges = _edges(topology, selection)
    result, ends = _move(topology, selection, values)
    if ends is None:
        return topology, edges
    now = Topology(result.shape)
    found = []
    for want in ends:
        for i in range(now.edge_count):
            curve = BRepAdaptor_Curve(now.edge(i))
            a, b = curve.Value(curve.FirstParameter()), curve.Value(curve.LastParameter())
            have = [(a.X(), a.Y(), a.Z()), (b.X(), b.Y(), b.Z())]
            if all(min(math.dist(w, h) for h in have) < 1e-5 for w in want):
                found.append(now.edge(i))
                break
        else:
            return topology, edges
    return now, found


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


"""Editing a displayed dimension in place: maps (selection, dimension kind, new value) to the tool that makes it so.

Only dimensions with one clear meaning are editable:

- `hole_diameter`: a hole or boss wall, or its circular rim edge (Resize hole).
- `fillet_radius`: a fillet face, or an arc edge of a fillet (Resize fillet).
- `edge_length`: a straight edge of a box-like corner; the flat face at one end moves (Push/Pull).
- `face_distance`: two parallel flat faces; one moves, the other stays (Push/Pull). `flip` swaps which.
- `hole_distance`: two holes or bosses, center to center; one moves along the line between them (Move hole).
- `face_angle`: a nearly upright flat face, its draft angle about the Z pull direction (Draft).

`annotate` adds an `edit` object (or an `editNote` reason) to each dimension of a `measure` reply; `resolve` turns an
edit request into `(tool id, selection json, params)` for the ordinary tool runner, so the edit is one undo step and
the live preview uses the same path as the tool's own form.
"""

import math
from dataclasses import dataclass
from typing import Callable

from OCP.Bnd import Bnd_Box
from OCP.BRepAdaptor import BRepAdaptor_Curve, BRepAdaptor_Surface
from OCP.BRepBndLib import BRepBndLib
from OCP.BRepTools import BRepTools
from OCP.GeomAbs import GeomAbs_Circle, GeomAbs_Cylinder, GeomAbs_Line
from OCP.TopAbs import TopAbs_VERTEX
from OCP.TopExp import TopExp, TopExp_Explorer
from OCP.gp import gp_Dir, gp_Vec

from .ops import MIN_DISTANCE, OperationError, planar_normal
from .tools import Selection
from .topology import Topology

PARALLEL_TOL = 1e-6
MAX_DRAFT_TILT = 45.0  # degrees off upright beyond which a flat face is not a draftable wall
PULL = gp_Dir(0, 0, 1)

EDIT_KINDS = ("hole_diameter", "fillet_radius", "edge_length", "face_distance", "hole_distance", "face_angle")


@dataclass
class Plan:
    """What an edit will do: the tool, the selection it runs on, how a value becomes params, and the current value."""

    tool: str
    selection: dict
    value: float
    params: Callable[[float], dict]
    can_flip: bool = False
    minimum: float = MIN_DISTANCE  # smallest value allowed (0 for an angle)


def _is_full_cylinder(face) -> bool:
    surface = BRepAdaptor_Surface(face)
    if surface.GetType() != GeomAbs_Cylinder:
        return False
    u0, u1, _, _ = BRepTools.UVBounds_s(face)
    return u1 - u0 >= 2 * math.pi - 1e-6


def _fillet_face(topology: Topology, face) -> bool:
    from .measure import _is_fillet

    surface = BRepAdaptor_Surface(face)
    if surface.GetType() != GeomAbs_Cylinder or _is_full_cylinder(face):
        return False
    return _is_fillet(topology, face, GeomAbs_Cylinder)


def _hole_plan(topology: Topology, selection: Selection) -> Plan:
    if selection.faces:
        face_id = selection.faces[0]
        if not _is_full_cylinder(topology.face(face_id)):
            raise OperationError("only the round wall of a hole or boss has a diameter to edit")
    else:
        edge = topology.edge(selection.edges[0])
        radius = BRepAdaptor_Curve(edge).Circle().Radius()
        walls = [f for f in topology.edge_faces(edge) if _is_full_cylinder(f) and abs(BRepAdaptor_Surface(f).Cylinder().Radius() - radius) < 1e-6]
        if len(walls) != 1:
            raise OperationError("this circle is not the rim of a single round hole or boss")
        face_id = topology.face_id(walls[0])
    radius = BRepAdaptor_Surface(topology.face(face_id)).Cylinder().Radius()
    return Plan("resize_hole", {"faces": [face_id]}, 2 * radius, lambda v: {"diameter": v})


def _fillet_plan(topology: Topology, selection: Selection) -> Plan:
    if selection.faces:
        face = topology.face(selection.faces[0])
        if not _fillet_face(topology, face):
            raise OperationError("this face is not a simple fillet")
    else:
        edge = topology.edge(selection.edges[0])
        radius = BRepAdaptor_Curve(edge).Circle().Radius()
        found = [f for f in topology.edge_faces(edge) if _fillet_face(topology, f) and abs(BRepAdaptor_Surface(f).Cylinder().Radius() - radius) < 1e-6]
        if len(found) != 1:
            raise OperationError("this arc is not the end of a single fillet")
        face = found[0]
    return Plan("resize_fillet", {"faces": [topology.face_id(face)]}, BRepAdaptor_Surface(face).Cylinder().Radius(), lambda v: {"radius": v, "end_radius": 0})


def _vertex_faces(topology: Topology, vertex) -> list:
    """Planar faces of the model that have this vertex."""
    found = []
    for _, face in topology.faces():
        if planar_normal(face) is None:
            continue
        explorer = TopExp_Explorer(face, TopAbs_VERTEX)
        while explorer.More():
            if explorer.Current().IsSame(vertex):
                found.append(face)
                break
            explorer.Next()
    return found


def _edge_plan(topology: Topology, selection: Selection, flip: bool) -> Plan:
    edge = topology.edge(selection.edges[0])
    curve = BRepAdaptor_Curve(edge)
    if curve.GetType() != GeomAbs_Line:
        raise OperationError("only a straight edge has a length to edit")
    around = topology.edge_faces(edge)
    if len(around) != 2:
        raise OperationError(f"this edge is shared by {len(around)} faces, so moving one face is ambiguous")
    if any(planar_normal(f) is None for f in around):
        raise OperationError("this edge borders a curved face, so its length is not set by one flat face")
    direction = curve.Line().Direction()
    from OCP.TopoDS import TopoDS_Vertex

    first, last = TopoDS_Vertex(), TopoDS_Vertex()
    TopExp.Vertices_s(edge, first, last)
    ends = []
    for vertex in (first, last):
        caps = [f for f in _vertex_faces(topology, vertex) if planar_normal(f).IsParallel(direction, PARALLEL_TOL)]
        ends.append(caps)
    index = 0 if flip else 1
    caps = ends[index]
    if len(caps) != 1:
        raise OperationError("the end of this edge is not on one flat face square to it, so there is no single face to move")
    length = curve.LastParameter() - curve.FirstParameter()
    cap = topology.face_id(caps[0])
    can_flip = len(ends[1 - index]) == 1
    return Plan("push_pull", {"faces": [cap]}, length, lambda v: {"distance": v - length}, can_flip)


def _planar_pair(topology: Topology, selection: Selection):
    faces = [topology.face(i) for i in selection.faces]
    normals = [planar_normal(f) for f in faces]
    if any(n is None for n in normals):
        raise OperationError("both faces must be flat")
    if not normals[0].IsParallel(normals[1], PARALLEL_TOL):
        raise OperationError("these faces are not parallel, so there is no single distance between them")
    return faces, normals


def _face_distance_plan(topology: Topology, selection: Selection, flip: bool) -> Plan:
    faces, normals = _planar_pair(topology, selection)
    planes = [BRepAdaptor_Surface(f).Plane() for f in faces]
    order = [0, 1] if not flip else [1, 0]  # the last one in `order` is the mover (default: the face clicked last)
    fixed, mover = order
    gap = gp_Vec(planes[fixed].Location(), planes[mover].Location()).Dot(gp_Vec(normals[mover]))
    distance = abs(gap)
    if distance < 1e-9:
        raise OperationError("these faces are in the same plane, so there is no distance to edit")
    sign = 1 if gap > 0 else -1  # +1: pulling the mover out increases the distance
    return Plan("push_pull", {"faces": [selection.faces[mover]]}, distance, lambda v: {"distance": sign * (v - distance)}, True)


def _hole_distance_plan(topology: Topology, selection: Selection, flip: bool) -> Plan:
    from .measure import hole_centre

    centres = [hole_centre(topology.face(i)) for i in selection.faces]
    if any(c is None for c in centres):
        raise OperationError("both must be whole round holes or bosses")
    fixed, mover = (0, 1) if not flip else (1, 0)
    vector = gp_Vec(centres[fixed], centres[mover])
    distance = vector.Magnitude()
    if distance < 1e-9:
        raise OperationError("these holes share a center, so there is no direction to move along")
    unit = vector.Normalized()

    def params(v: float) -> dict:
        step = unit.Multiplied(v - distance)
        return {"dx": step.X(), "dy": step.Y(), "dz": step.Z()}

    return Plan("move_hole", {"faces": [selection.faces[mover]]}, distance, params, True, minimum=0.0)


def _tag_point(face, anchor) -> list[float]:
    """Where a wall's draft angle tag sits: near the top of the face, so it stays off the push/pull arrow that stands on the face's center."""
    box = Bnd_Box()
    BRepBndLib.AddOptimal_s(face, box, False, False)
    z_low, z_high = box.CornerMin().Z(), box.CornerMax().Z()
    return [anchor[0], anchor[1], z_high - 0.2 * (z_high - z_low)]


def draft_angle(face) -> float | None:
    """Signed draft angle of an upright flat face about the Z pull, in degrees (positive: the wall leans so the part narrows going up)."""
    normal = planar_normal(face)
    if normal is None:
        return None
    angle = math.degrees(math.asin(max(-1.0, min(1.0, normal.Dot(PULL)))))
    return angle if abs(angle) <= MAX_DRAFT_TILT else None


def _face_angle_plan(topology: Topology, selection: Selection) -> Plan:
    angle = draft_angle(topology.face(selection.faces[0]))
    if angle is None:
        raise OperationError("only an upright wall (within 45 degrees of vertical) has a draft angle")
    return Plan("draft", {"faces": selection.faces[:1]}, angle, lambda v: {"angle": v, "pull_x": 0, "pull_y": 0, "pull_z": 1, "axis": 2}, minimum=-MAX_DRAFT_TILT)


def plan(topology: Topology, selection: Selection, kind: str, flip: bool = False) -> Plan:
    if kind == "hole_diameter" and len(selection.faces) + len(selection.edges) == 1:
        return _hole_plan(topology, selection)
    if kind == "fillet_radius" and len(selection.faces) + len(selection.edges) == 1:
        return _fillet_plan(topology, selection)
    if kind == "edge_length" and len(selection.edges) == 1 and not selection.faces:
        return _edge_plan(topology, selection, flip)
    if kind == "face_distance" and len(selection.faces) == 2 and not selection.edges:
        return _face_distance_plan(topology, selection, flip)
    if kind == "hole_distance" and len(selection.faces) == 2 and not selection.edges:
        return _hole_distance_plan(topology, selection, flip)
    if kind == "face_angle" and len(selection.faces) == 1 and not selection.edges:
        return _face_angle_plan(topology, selection)
    raise OperationError("this dimension cannot be edited for the current selection")


def resolve(topology: Topology, selection: Selection, kind: str, value: float, flip: bool = False) -> tuple[str, dict, dict]:
    """The tool id, selection and params that set the dimension `kind` to `value`."""
    if not math.isfinite(value):
        raise OperationError("enter a number")
    p = plan(topology, selection, kind, flip)
    if value < p.minimum:
        raise OperationError("the value must be larger than zero" if p.minimum == MIN_DISTANCE else f"the value must be at least {p.minimum:g}")
    return p.tool, p.selection, p.params(value)


def _entry(topology: Topology, selection: Selection, kind: str) -> dict:
    """The `edit` object for one dimension: editable with its current value, or editable-in-principle but blocked with a reason."""
    try:
        p = plan(topology, selection, kind)
        return {"edit": {"kind": kind, "value": p.value, "canFlip": p.can_flip}}
    except OperationError as e:
        return {"edit": {"kind": kind, "value": None, "canFlip": False, "blocked": str(e)}}


def annotate(topology: Topology, selection: Selection, result: dict) -> None:
    """Mark each dimension of a `measure` reply as editable (`edit`) or not (`editNote`), in place."""
    dims = result["dimensions"]
    items = result["items"]
    sel_n = len(selection.faces) + len(selection.edges) + len(selection.vertices)
    for dim in dims:
        dim["editNote"] = "This value is not an editable dimension"
    if sel_n == 1 and len(items) == 1:
        item = items[0]
        if item["kind"] == "face":
            face = topology.face(selection.faces[0])
            if _is_full_cylinder(face):
                dims[0].update(_entry(topology, selection, "hole_diameter"))
                if len(dims) > 1:
                    dims[1]["editNote"] = "A hole's depth is changed with Edit hole or by pushing its end face"
            elif _fillet_face(topology, face):
                dims[0].update(_entry(topology, selection, "fillet_radius"))
            elif planar_normal(face) is not None:
                for d in dims:
                    d["editNote"] = "A face's size is set by its edges: select an edge and edit its length"
                angle = draft_angle(face)
                if angle is not None:
                    dim = {"kind": "tag", "text": f"∠{angle:.3g}°", "points": [_tag_point(face, item["anchor"])]}
                    dim.update(_entry(topology, selection, "face_angle"))
                    dims.append(dim)
        elif item["kind"] == "edge" and dims:
            curve = BRepAdaptor_Curve(topology.edge(selection.edges[0]))
            if curve.GetType() == GeomAbs_Line:
                dims[0].update(_entry(topology, selection, "edge_length"))
            elif curve.GetType() == GeomAbs_Circle:
                full = dims[0]["kind"] == "diameter"
                dims[0].update(_entry(topology, selection, "hole_diameter" if full else "fillet_radius"))
        elif item["kind"] == "vertex":
            dims[0]["editNote"] = "A point's position is not a dimension"
    elif len(items) == 2 and len(dims) == 1 and dims[0]["kind"] == "linear" and len(selection.faces) == 2:
        from .measure import hole_centre

        faces = [topology.face(i) for i in selection.faces]
        centres = [hole_centre(f) for f in faces]
        if all(c is not None for c in centres):
            dims[0].update(_entry(topology, selection, "hole_distance"))
        elif all(c is None for c in centres):
            dims[0].update(_entry(topology, selection, "face_distance"))
        else:
            dims[0]["editNote"] = "Move the hole with Move hole to change its distance to the face"
    elif len(items) == 2 and dims:
        dims[0]["editNote"] = "Only the distance between two faces or two holes can be edited"
    elif len(items) > 2:
        for d in dims:
            d["editNote"] = "A total is not an editable dimension"

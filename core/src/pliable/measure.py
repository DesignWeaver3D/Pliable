"""Measurements of selected edges, faces and vertices, as label/value rows for the UI.

Lengths are in model units (no unit label until there is a units setting); angles in degrees.
Each item is `{"kind", "id", "title", "rows": [{"label", "value", "unit"}], "anchor": [x, y, z],
"dimensions": [...]}`. A dimension is the most useful value drawn on the model:
`{"kind": "linear" | "diameter" | "radius" | "tag", "text", "points": [[x, y, z], ...], "offsetDirection"?}`.
Linear: two points measured between, drawn offset along `offsetDirection` (a model-space unit vector,
pointing away from the part). Diameter: two opposite rim points. Radius: center then rim point.
Tag: one anchor point.
"""

import math

from OCP.BRep import BRep_Tool
from OCP.GeomAPI import GeomAPI_ProjectPointOnSurf
from OCP.GeomLProp import GeomLProp_SLProps
from OCP.BRepAdaptor import BRepAdaptor_Curve, BRepAdaptor_Surface
from OCP.BRepExtrema import BRepExtrema_DistShapeShape
from OCP.BRepGProp import BRepGProp
from OCP.BRepTools import BRepTools
from OCP.GeomAbs import (
    GeomAbs_Circle,
    GeomAbs_Cone,
    GeomAbs_Cylinder,
    GeomAbs_Ellipse,
    GeomAbs_Line,
    GeomAbs_Plane,
    GeomAbs_Sphere,
    GeomAbs_Torus,
)
from OCP.GProp import GProp_GProps
from OCP.gp import gp_Vec
from OCP.TopAbs import TopAbs_EDGE
from OCP.TopExp import TopExp_Explorer
from OCP.TopoDS import TopoDS

from .ops import OperationError, edge_outward_normal
from .tools import Selection
from .topology import Topology

TANGENT_TOL = 1e-6  # 1 - |cos| of the angle between normals below which faces count as tangent
FULL_TURN_TOL = 1e-6  # radians: a sweep this close to 2*pi counts as a full circle


def _row(label: str, value, unit: str = "") -> dict:
    return {"label": label, "value": value, "unit": unit}


def _xyz(p) -> list[float]:
    return [p.X(), p.Y(), p.Z()]


def _dir_row(label: str, d) -> dict:
    return _row(label, [d.X(), d.Y(), d.Z()])


def _fmt(value: float) -> str:
    return f"{value:.3f}".rstrip("0").rstrip(".").replace("-0", "0") if abs(value) >= 5e-4 else "0"


def _dim(kind: str, text: str, points, offset=None) -> dict:
    dim = {"kind": kind, "text": text, "points": [p if isinstance(p, list) else _xyz(p) for p in points]}
    if offset is not None:
        dim["offsetDirection"] = offset
    return dim


def _perpendicular(direction, along) -> list[float] | None:
    """`direction` (list) with its component along `along` (gp_Dir) removed, normalized; None if parallel."""
    dot = sum(a * b for a, b in zip(direction, (along.X(), along.Y(), along.Z())))
    rest = [a - dot * b for a, b in zip(direction, (along.X(), along.Y(), along.Z()))]
    length = math.sqrt(sum(c * c for c in rest))
    return [c / length for c in rest] if length > 1e-6 else None


def _props(shape, surface: bool) -> GProp_GProps:
    props = GProp_GProps()
    (BRepGProp.SurfaceProperties_s if surface else BRepGProp.LinearProperties_s)(shape, props)
    return props


def measure_edge(edge_id: int, edge, topology: Topology | None = None) -> dict:
    curve = BRepAdaptor_Curve(edge)
    kind = curve.GetType()
    span = curve.LastParameter() - curve.FirstParameter()
    props = _props(edge, False)
    rows = [_row("Length", props.Mass())]
    dims = []
    if kind == GeomAbs_Line:
        title = "Line"
        away = edge_outward_normal(topology, edge) if topology else None
        offset = _perpendicular(away, curve.Line().Direction()) if away else None
        dims.append(_dim("linear", _fmt(props.Mass()), [curve.Value(curve.FirstParameter()), curve.Value(curve.LastParameter())], offset))
        rows.append(_dir_row("Direction", curve.Line().Direction()))
    elif kind == GeomAbs_Circle:
        circle = curve.Circle()
        full = abs(span - 2 * math.pi) < FULL_TURN_TOL
        title = "Circle" if full else "Arc"
        rows += [_row("Radius", circle.Radius()), _row("Diameter", 2 * circle.Radius())]
        first = curve.Value(curve.FirstParameter())
        if full:
            far = circle.Location().Translated(gp_Vec(first, circle.Location()))
            dims.append(_dim("diameter", "⌀" + _fmt(2 * circle.Radius()), [first, far]))
        else:
            dims.append(_dim("radius", "R" + _fmt(circle.Radius()), [circle.Location(), curve.Value((curve.FirstParameter() + curve.LastParameter()) / 2)]))
        if not full:
            rows.append(_row("Arc angle", math.degrees(span), "°"))
        rows += [_row("Center", _xyz(circle.Location())), _dir_row("Axis", circle.Axis().Direction())]
    elif kind == GeomAbs_Ellipse:
        title = "Ellipse"
        ellipse = curve.Ellipse()
        rows += [_row("Major radius", ellipse.MajorRadius()), _row("Minor radius", ellipse.MinorRadius())]
    else:
        title = "Curve"
    return {"kind": "edge", "id": edge_id, "title": title, "rows": rows, "anchor": _xyz(props.CentreOfMass()), "dimensions": dims}


def _normal_at(face, point):
    surface = BRep_Tool.Surface_s(face)
    projection = GeomAPI_ProjectPointOnSurf(point, surface)
    u, v = projection.LowerDistanceParameters()
    props = GeomLProp_SLProps(surface, u, v, 1, 1e-6)
    return props.Normal()


def _tangent(edge, face_a, face_b) -> bool:
    """True if the two faces meet smoothly along the edge (checked at its midpoint).

    BRep_Tool.Continuity is not usable: booleans leave every edge at C0.
    """
    curve = BRepAdaptor_Curve(edge)
    point = curve.Value((curve.FirstParameter() + curve.LastParameter()) / 2)
    return abs(_normal_at(face_a, point).Dot(_normal_at(face_b, point))) > 1 - TANGENT_TOL


def _is_fillet(topology: Topology, face, surface_type) -> bool:
    """A partial cylinder/torus that meets a differently-shaped neighbor tangentially."""
    explorer = TopExp_Explorer(face, TopAbs_EDGE)
    while explorer.More():
        edge = TopoDS.Edge(explorer.Current())
        for other in topology.edge_faces(edge):
            if other.IsSame(face) or BRepAdaptor_Surface(other).GetType() == surface_type:
                continue
            if _tangent(edge, face, other):
                return True
        explorer.Next()
    return False


def _plane_dims(face, surface, u0, u1, v0, v1) -> list[dict]:
    """Width and height along the plane's own axes, each offset away from the face's middle."""
    at = surface.Value
    x, y = surface.Plane().XAxis().Direction(), surface.Plane().YAxis().Direction()
    mid_u, mid_v = (u0 + u1) / 2, (v0 + v1) / 2
    return [
        _dim("linear", _fmt(u1 - u0), [at(u0, v0), at(u1, v0)], [-y.X(), -y.Y(), -y.Z()]),
        _dim("linear", _fmt(v1 - v0), [at(u0, v0), at(u0, v1)], [-x.X(), -x.Y(), -x.Z()]),
    ]


def _cylinder_dims(surface, cylinder, fillet: bool, u0, u1, v0, v1) -> list[dict]:
    """A fillet shows its radius; a hole or boss shows diameter and length along the axis."""
    at = surface.Value
    axis = cylinder.Axis()
    radius = cylinder.Radius()
    if fillet:
        on_axis = axis.Location().Translated(gp_Vec(axis.Direction()).Multiplied((v0 + v1) / 2))
        return [_dim("radius", "R" + _fmt(radius), [on_axis, at((u0 + u1) / 2, (v0 + v1) / 2)])]
    first, opposite = at(u0, v0), at(u0 + math.pi, v0)
    outward = gp_Vec(opposite, first).Normalized()  # away from the axis, on the side of `first`
    return [
        _dim("diameter", "⌀" + _fmt(2 * radius), [first, opposite]),
        _dim("linear", _fmt(v1 - v0), [first, at(u0, v1)], [outward.X(), outward.Y(), outward.Z()]),
    ]


def measure_face(topology: Topology, face_id: int, face) -> dict:
    surface = BRepAdaptor_Surface(face)
    kind = surface.GetType()
    u0, u1, v0, v1 = BRepTools.UVBounds_s(face)
    props = _props(face, True)
    area = _row("Area", props.Mass())
    dims = []
    if kind == GeomAbs_Plane:
        title = "Plane"
        dims = _plane_dims(face, surface, u0, u1, v0, v1)
        rows = [_row("Width", u1 - u0), _row("Height", v1 - v0), area, _dir_row("Normal", surface.Plane().Axis().Direction())]
    elif kind == GeomAbs_Cylinder:
        cylinder = surface.Cylinder()
        radius = cylinder.Radius()
        partial = (u1 - u0) < 2 * math.pi - FULL_TURN_TOL
        title = "Fillet" if partial and _is_fillet(topology, face, kind) else "Cylinder"
        rows = [_row("Radius", radius), _row("Diameter", 2 * radius), _row("Length", v1 - v0), area]
        if partial:
            rows.append(_row("Sweep", math.degrees(u1 - u0), "°"))
        dims = _cylinder_dims(surface, cylinder, partial and title == "Fillet", u0, u1, v0, v1)
        rows.append(_dir_row("Axis", cylinder.Axis().Direction()))
    elif kind == GeomAbs_Cone:
        cone = surface.Cone()
        title = "Cone"
        rows = [_row("Half angle", math.degrees(abs(cone.SemiAngle())), "°"), _row("Radius at base", cone.RefRadius()), area]
    elif kind == GeomAbs_Sphere:
        title = "Sphere"
        rows = [_row("Radius", surface.Sphere().Radius()), area]
    elif kind == GeomAbs_Torus:
        torus = surface.Torus()
        title = "Fillet" if _is_fillet(topology, face, kind) else "Torus"
        rows = [_row("Major radius", torus.MajorRadius()), _row("Minor radius", torus.MinorRadius()), area]
    else:
        title = "Surface"
        rows = [area]
    return {"kind": "face", "id": face_id, "title": title, "rows": rows, "anchor": _xyz(props.CentreOfMass()), "dimensions": dims}


def measure_vertex(vertex_id: int, vertex) -> dict:
    point = BRep_Tool.Pnt_s(vertex)
    rows = [_row("X", point.X()), _row("Y", point.Y()), _row("Z", point.Z())]
    return {"kind": "vertex", "id": vertex_id, "title": "Vertex", "rows": rows, "anchor": _xyz(point),
            "dimensions": [_dim("tag", f"({_fmt(point.X())}, {_fmt(point.Y())}, {_fmt(point.Z())})", [point])]}


def _direction(topology: Topology, kind: str, item_id: int):
    """The direction an item defines (line direction or plane normal), or None."""
    if kind == "edge":
        curve = BRepAdaptor_Curve(topology.edge(item_id))
        return curve.Line().Direction() if curve.GetType() == GeomAbs_Line else None
    if kind == "face":
        surface = BRepAdaptor_Surface(topology.face(item_id))
        return surface.Plane().Axis().Direction() if surface.GetType() == GeomAbs_Plane else None
    return None


def _pair_rows(topology: Topology, a: tuple, b: tuple) -> tuple[list[dict], list[dict]]:
    """Distance between two items (and the dimension between their closest points), and the angle
    between their directions where both have one."""
    shapes = [getattr(topology, kind)(item_id) for kind, item_id in (a, b)]
    extrema = BRepExtrema_DistShapeShape(shapes[0], shapes[1])
    rows, dims = [], []
    if extrema.IsDone():
        rows.append(_row("Distance", extrema.Value()))
        dims.append(_dim("linear", _fmt(extrema.Value()), [extrema.PointOnShape1(1), extrema.PointOnShape2(1)]))
    da, db = _direction(topology, *a), _direction(topology, *b)
    if da is not None and db is not None:
        angle = math.degrees(da.Angle(db))
        rows.append(_row("Angle", min(angle, 180 - angle) if a[0] == "edge" else angle, "°"))
    return rows, dims


def measure(topology: Topology, selection: Selection) -> dict:
    """Per-item measurements plus a summary (count and totals, or the pair distance and angle)."""
    items = (
        [measure_face(topology, i, topology.face(i)) for i in selection.faces]
        + [measure_edge(i, topology.edge(i), topology) for i in selection.edges]
        + [measure_vertex(i, topology.vertex(i)) for i in selection.vertices]
    )
    if len({item["kind"] for item in items}) > 1:
        raise OperationError("measure one kind of item at a time")
    summary, dims = [], []
    if len(items) > 1:
        summary.append(_row("Selected", len(items)))
        for label in ("Length", "Area"):
            values = [r["value"] for item in items for r in item["rows"] if r["label"] == label]
            if len(values) == len(items):
                summary.append(_row(f"Total {label.lower()}", sum(values)))
                centroid = [sum(item["anchor"][k] for item in items) / len(items) for k in range(3)]
                dims = [_dim("tag", f"Σ {_fmt(sum(values))}", [centroid])]
    if len(items) == 2:
        rows, pair_dims = _pair_rows(topology, *[(item["kind"], item["id"]) for item in items])
        summary += rows
        dims = pair_dims or dims
    return {"items": items, "summary": summary, "dimensions": dims if len(items) > 1 else [d for item in items for d in item["dimensions"]]}

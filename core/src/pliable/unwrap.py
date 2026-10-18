"""Sketching on unrolled faces (S33).

Some surfaces unroll onto a plane without stretching, so a sketch drawn on the flat result maps back exactly.
Two kinds are supported:

* A cone face unrolls to a circular sector: distance from the apex becomes distance from a point in the
  plane, the angle around the axis is scaled by the sine of the half angle.
* A chain of faces joined along straight edges that all run in one direction (flat faces and cylinders whose
  axis has that direction, like a bent sheet or a block with rounded edges) unrolls to a strip: arc length along
  the cross-section becomes u, the position along the common direction becomes v. A single cylinder face is a
  chain of one.

Closed regions of the sketch are cut into one piece per face of the chain, each piece becomes a face on its own
surface (its outline is the same 2D curves written in that surface's parameter space), and the pieces are
imprinted on the model with the splitter like an ordinary sketch region. A single cylinder or cone is not
clipped, so a region may run across the seam of a full revolution.

Spheres, tori and free-form faces do not unroll without stretching and are refused.
"""

import math
from dataclasses import dataclass, field
from typing import Callable

from build123d import Face, Location, Wire
from OCP.BRep import BRep_Tool
from OCP.BRepAdaptor import BRepAdaptor_Curve, BRepAdaptor_Surface
from OCP.BRepAlgoAPI import BRepAlgoAPI_Splitter
from OCP.BRepBuilderAPI import BRepBuilderAPI_MakeEdge, BRepBuilderAPI_MakeFace, BRepBuilderAPI_MakeWire
from OCP.BRepLib import BRepLib
from OCP.BRepTools import BRepTools
from OCP.collections import HArray1_gp_Pnt2d, List_TopoDS_Shape
from OCP.Geom2d import Geom2d_Line, Geom2d_TrimmedCurve
from OCP.Geom2dAPI import Geom2dAPI_Interpolate
from OCP.GeomAbs import GeomAbs_Cone, GeomAbs_Cylinder, GeomAbs_Line, GeomAbs_Plane
from OCP.gp import gp_Dir2d, gp_Pnt, gp_Pnt2d
from OCP.ShapeAnalysis import ShapeAnalysis_Surface
from OCP.TopAbs import TopAbs_EDGE, TopAbs_VERTEX
from OCP.TopExp import TopExp_Explorer
from OCP.TopoDS import TopoDS

from .ops import OperationError
from .tessellate import bounds
from .sketch import STANDARD_PLANES, SketchError, regions

CURVE_SAMPLES = 48
TOL = 1e-6


class UnwrapError(OperationError):
    pass


@dataclass
class Band:
    """The part of the unrolled plane that maps onto one face."""

    face: object  # TopoDS_Face
    surface: object  # Geom_Surface, location applied
    x0: float
    x1: float
    # (x, y) of the unrolled plane -> (u, v) parameters of `surface`
    to_param: Callable[[float, float], tuple[float, float]]
    linear: bool = True  # straight lines of the sketch stay straight in parameter space
    periodic_u: float | None = None
    # Closed surfaces repeat in the unrolled plane: copy k of the face covers clip(k), and a region there is
    # mapped with its angle moved back by k turns. Other bands have only copy 0.
    copies: tuple[int, ...] = (0,)
    clip: Callable[[int], list[tuple[float, float]]] | None = None


@dataclass
class Unrolling:
    bands: list[Band]
    reference: dict
    faces: list = field(default_factory=list)
    # Set when the faces cannot unroll without stretching: {"max": worst length error as a fraction, "note": text}.
    distortion: dict | None = None


def unwrap_plane(shape=None, reference: dict | None = None) -> dict:
    """The sketch plane the unrolled faces are drawn on: the XY plane, moved sideways to lie beside the model
    (past its largest x, centred on y) so the flat outline does not sit over it. Sketch coordinates stay
    relative to the plane origin, and `wrap_regions` undoes the shift."""
    plane = dict(STANDARD_PLANES["XY"])
    if shape is None or not reference or not reference.get("points"):
        return plane
    xmin, ymin, _, xmax, ymax, _ = bounds(shape)
    reach = max(abs(p["u"]) for p in reference["points"])
    margin = max(10.0, (xmax - xmin) * 0.1)
    plane["origin"] = [round(xmax + margin + reach), round((ymin + ymax) / 2), 0.0]
    return plane


# Geometry helpers ------------------------------------------------------------------------------------


def _edges(face):
    explorer = TopExp_Explorer(face, TopAbs_EDGE)
    out = []
    while explorer.More():
        out.append(TopoDS.Edge(explorer.Current()))
        explorer.Next()
    return out


def _vertices(shape):
    explorer = TopExp_Explorer(shape, TopAbs_VERTEX)
    out = []
    while explorer.More():
        p = BRep_Tool.Pnt_s(TopoDS.Vertex(explorer.Current()))
        out.append((p.X(), p.Y(), p.Z()))
        explorer.Next()
    return out


def _dot(a, b):
    return sum(x * y for x, y in zip(a, b))


def _sub(a, b):
    return tuple(x - y for x, y in zip(a, b))


def _add(a, b):
    return tuple(x + y for x, y in zip(a, b))


def _scale(a, k):
    return tuple(x * k for x in a)


def _norm(a):
    return math.sqrt(_dot(a, a))


def _kind(face):
    return BRepAdaptor_Surface(face).GetType()


def is_flat(face) -> bool:
    return _kind(face) == GeomAbs_Plane


_SURFACE_NAMES = {}


def describe_faces(faces) -> str:
    """Surface types of the faces in words, for refusal messages and the diagnostic report."""
    if not _SURFACE_NAMES:
        from OCP import GeomAbs

        for name in ("Plane", "Cylinder", "Cone", "Sphere", "Torus", "BezierSurface", "BSplineSurface", "SurfaceOfRevolution", "SurfaceOfExtrusion", "OffsetSurface"):
            _SURFACE_NAMES[getattr(GeomAbs, "GeomAbs_" + name)] = name
    names = [_SURFACE_NAMES.get(_kind(f), "other surface") for f in faces]
    return "selected: " + ", ".join(f"{n} x{names.count(n)}" for n in dict.fromkeys(names))


def _shared(f1, f2):
    e2 = _edges(f2)
    return [e for e in _edges(f1) if any(e.IsSame(o) for o in e2)]


def _order(faces):
    """Indices of the faces as a chain (each joined to the next by a shared edge), or an error."""
    n = len(faces)
    if n == 1:
        return [0]
    neighbours = {i: [j for j in range(n) if j != i and _shared(faces[i], faces[j])] for i in range(n)}
    ends = [i for i in range(n) if len(neighbours[i]) == 1]
    if any(len(v) == 0 or len(v) > 2 for v in neighbours.values()) or len(ends) != 2:
        raise UnwrapError("The selected faces do not form a single chain joined along edges")
    order, previous = [ends[0]], None
    while len(order) < n:
        current = order[-1]
        following = [j for j in neighbours[current] if j != previous]
        if not following:
            break
        previous = current
        order.append(following[0])
    if len(order) != n:
        raise UnwrapError("The selected faces do not form a single chain joined along edges")
    return order


# Cone ------------------------------------------------------------------------------------------------


def _cone_unrolling(face) -> Unrolling:
    cone = BRepAdaptor_Surface(face).Cone()
    alpha = cone.SemiAngle()
    k = abs(math.sin(alpha))
    apex_v = -cone.RefRadius() / math.sin(alpha)  # parameter v of the apex along the generator
    u0, u1, v0, v1 = BRepTools.UVBounds_s(face)
    umid, vmid = (u0 + u1) / 2, (v0 + v1) / 2
    sign = 1.0 if vmid > apex_v else -1.0
    s0, s1 = sorted((abs(v0 - apex_v), abs(v1 - apex_v)))
    smid = (s0 + s1) / 2
    if s0 < 1e-9:
        raise UnwrapError("Cones that reach their apex are not supported")
    half = (u1 - u0) / 2 * k  # half the angle of the sector in the plane
    if half >= math.pi / 2:
        raise UnwrapError("This cone unrolls to more than half a turn, which is not supported")

    def to_param(x, y):
        dy = y + smid
        return umid + math.atan2(x, dy) / k, apex_v + sign * math.hypot(x, dy)

    apex = (0.0, -smid)
    points = [{"id": 1, "u": apex[0], "v": apex[1], "fixed": True}]
    for s in (s0, s1):  # ids 2, 3 (inner end: right, left) and 4, 5 (outer end: right, left)
        for side in (1, -1):
            points.append({"id": len(points) + 1, "u": apex[0] + side * s * math.sin(half), "v": apex[1] + s * math.cos(half), "fixed": True})
    entities = []

    def add(entity):
        entities.append({"id": 1001 + len(entities), "construction": True, "reference": True, **entity})

    add({"type": "arc", "center": 1, "start": 2, "end": 3})  # counterclockwise runs from the right end to the left
    add({"type": "arc", "center": 1, "start": 4, "end": 5})
    add({"type": "line", "a": 2, "b": 4})
    add({"type": "line", "a": 3, "b": 5})
    full = abs((u1 - u0) - 2 * math.pi) < 1e-6

    def wedge(j: int) -> list[tuple[float, float]]:
        # the sector of copy j: between two rays from the apex, a half turn at most wide, out beyond the face
        far = 4 * s1 + 1.0
        angles = [(2 * j - 1) * half, 2 * j * half, (2 * j + 1) * half]
        return [apex] + [(apex[0] + far * math.sin(a), apex[1] + far * math.cos(a)) for a in angles]

    band = Band(face, BRep_Tool.Surface_s(face), -math.inf, math.inf, to_param, linear=False, periodic_u=2 * math.pi, copies=(-1, 0, 1) if full else (0,), clip=wedge)
    return Unrolling([band], {"points": points, "entities": entities}, faces=[face])


# Chains of flat faces and cylinders ------------------------------------------------------------------


def _common_direction(faces):
    """The direction every face runs along: a cylinder's axis, else the direction of the faces' first straight edge."""
    for face in faces:
        if _kind(face) == GeomAbs_Cylinder:
            z = BRepAdaptor_Surface(face).Cylinder().Axis().Direction()
            return (z.X(), z.Y(), z.Z())
    for face in faces:
        for edge in _edges(face):
            curve = BRepAdaptor_Curve(edge)
            if curve.GetType() == GeomAbs_Line:
                a, b = curve.Value(curve.FirstParameter()), curve.Value(curve.LastParameter())
                v = (b.X() - a.X(), b.Y() - a.Y(), b.Z() - a.Z())
                if _norm(v) > TOL:
                    return _scale(v, 1 / _norm(v))
    raise UnwrapError("Could not find a common direction for these faces")


def _strip_unrolling(faces) -> Unrolling:
    faces = [faces[i] for i in _order(faces)]
    d = _common_direction(faces)

    def flat(p):  # the cross-section position of a 3D point: drop the part along d
        return _sub(p, _scale(d, _dot(p, d)))

    heights = [_dot(p, d) for f in faces for p in _vertices(f)]
    vmin, vmax = min(heights), max(heights)
    vmid = (vmin + vmax) / 2

    pieces = []
    for index, face in enumerate(faces):
        kind = _kind(face)
        if kind not in (GeomAbs_Plane, GeomAbs_Cylinder):
            raise UnwrapError("Only flat faces, cylinders and cones can be unrolled")
        shared_prev = _shared(face, faces[index - 1]) if index > 0 else []
        shared_next = _shared(face, faces[index + 1]) if index + 1 < len(faces) else []
        for edge in shared_prev + shared_next:
            ends = [flat(p) for p in _vertices(edge)]
            if len(ends) == 2 and _norm(_sub(ends[0], ends[1])) > 1e-5:
                raise UnwrapError("These faces are not joined along edges that all run in the same direction")
        flat_vertices = [flat(p) for p in _vertices(face)]
        if kind == GeomAbs_Plane:
            normal = BRepAdaptor_Surface(face).Plane().Axis().Direction()
            if abs(normal.X() * d[0] + normal.Y() * d[1] + normal.Z() * d[2]) > 1e-6:
                raise UnwrapError("A flat face is not parallel to the direction of the others")
            if shared_prev:
                start = flat(_vertices(shared_prev[0])[0])
            elif shared_next:
                far = flat(_vertices(shared_next[0])[0])
                start = max(flat_vertices, key=lambda p: _norm(_sub(p, far)))
            else:
                start = max(flat_vertices, key=lambda p: _norm(_sub(p, flat_vertices[0])))
            end = flat(_vertices(shared_next[0])[0]) if shared_next else max(flat_vertices, key=lambda p: _norm(_sub(p, start)))
            pieces.append({"kind": "plane", "start": start, "end": end, "length": _norm(_sub(end, start))})
        else:
            cylinder = BRepAdaptor_Surface(face).Cylinder()
            axis = cylinder.Axis().Direction()
            if abs(abs(axis.X() * d[0] + axis.Y() * d[1] + axis.Z() * d[2]) - 1) > 1e-6:
                raise UnwrapError("A cylinder's axis is not parallel to the direction of the others")
            u0, u1, _, _ = BRepTools.UVBounds_s(face)
            analysis = ShapeAnalysis_Surface(BRep_Tool.Surface_s(face))

            def angle_of(p, u0=u0, u1=u1, analysis=analysis):
                u = analysis.ValueOfUV(gp_Pnt(*p), TOL).X()
                for k in (-2, -1, 0, 1, 2):  # the angle equal to u (mod a turn) that lies in the face's range
                    if u0 - 1e-7 <= u + 2 * math.pi * k <= u1 + 1e-7:
                        return u + 2 * math.pi * k
                return min((u0, u1), key=lambda e: abs(((u - e + math.pi) % (2 * math.pi)) - math.pi))

            ua, ub = u0, u1
            if shared_prev:
                ua = angle_of(_vertices(shared_prev[0])[0])
                ub = u1 if abs(ua - u0) <= abs(ua - u1) else u0
            elif shared_next:
                ub = angle_of(_vertices(shared_next[0])[0])
                ua = u1 if abs(ub - u0) <= abs(ub - u1) else u0
            radius = cylinder.Radius()
            pieces.append({"kind": "cylinder", "ua": ua, "ub": ub, "radius": radius, "length": radius * abs(ub - ua), "cylinder": cylinder})

    total = sum(p["length"] for p in pieces)
    bands, x = [], -total / 2
    for face, piece in zip(faces, pieces):
        surface = BRep_Tool.Surface_s(face)
        analysis = ShapeAnalysis_Surface(surface)
        x0 = x
        x += piece["length"]

        if piece["kind"] == "plane":
            start, end, length = piece["start"], piece["end"], piece["length"]
            unit = _scale(_sub(end, start), 1 / (length or 1))

            def point3d(px, py, start=start, unit=unit, x0=x0):
                return _add(_add(start, _scale(unit, px - x0)), _scale(d, vmid + py))

        else:
            cylinder = piece["cylinder"]
            loc = cylinder.Location()
            cx, cy = cylinder.XAxis().Direction(), cylinder.YAxis().Direction()
            centre = flat((loc.X(), loc.Y(), loc.Z()))
            ua, radius = piece["ua"], piece["radius"]
            sign = 1.0 if piece["ub"] >= ua else -1.0

            def point3d(px, py, centre=centre, cx=cx, cy=cy, ua=ua, sign=sign, radius=radius, x0=x0):
                u = ua + sign * (px - x0) / radius
                p = (
                    centre[0] + radius * (math.cos(u) * cx.X() + math.sin(u) * cy.X()),
                    centre[1] + radius * (math.cos(u) * cx.Y() + math.sin(u) * cy.Y()),
                    centre[2] + radius * (math.cos(u) * cx.Z() + math.sin(u) * cy.Z()),
                )
                return _add(p, _scale(d, vmid + py))

        def to_param(px, py, point3d=point3d, analysis=analysis):
            uv = analysis.ValueOfUV(gp_Pnt(*point3d(px, py)), 1e-7)
            return uv.X(), uv.Y()

        full = piece["kind"] == "cylinder" and len(faces) == 1 and abs(abs(piece["ub"] - piece["ua"]) - 2 * math.pi) < 1e-6
        width = x - x0
        bands.append(
            Band(
                face, surface, x0, x, to_param, linear=True,
                periodic_u=2 * math.pi if piece["kind"] == "cylinder" else None,
                copies=(-1, 0, 1) if full else (0,),
                clip=lambda j, x0=x0, x1=x, width=width: [(x0 + j * width, -1e6), (x1 + j * width, -1e6), (x1 + j * width, 1e6), (x0 + j * width, 1e6)],
            )
        )

    # Reference outline: the strip and a divider at each face boundary.
    half_h = (vmax - vmin) / 2
    corners = [(-total / 2, -half_h), (total / 2, -half_h), (total / 2, half_h), (-total / 2, half_h)]
    points = [{"id": i + 1, "u": u, "v": v, "fixed": True} for i, (u, v) in enumerate(corners)]
    entities = [{"id": 1001 + i, "type": "line", "a": i + 1, "b": (i + 1) % 4 + 1, "construction": True, "reference": True} for i in range(4)]
    for band in bands[1:]:
        a, b = len(points) + 1, len(points) + 2
        points += [{"id": a, "u": band.x0, "v": -half_h, "fixed": True}, {"id": b, "u": band.x0, "v": half_h, "fixed": True}]
        entities.append({"id": 1001 + len(entities), "type": "line", "a": a, "b": b, "construction": True, "reference": True})
    return Unrolling(bands, {"points": points, "entities": entities}, faces=faces)


def build_unrolling(topology, face_ids: list[int]) -> Unrolling:
    try:
        faces = [topology.face(i) for i in face_ids]
    except KeyError as e:
        raise UnwrapError("Unknown face") from e
    if not faces:
        raise UnwrapError("Select the faces to unroll")
    if len(faces) == 1 and _kind(faces[0]) == GeomAbs_Cone:
        return _cone_unrolling(faces[0])
    if any(_kind(f) == GeomAbs_Cone for f in faces):
        raise UnwrapError("A cone can only be unrolled on its own")
    return _strip_unrolling(faces)


# Mapping a sketch back ---------------------------------------------------------------------------------


def _pcurve(edge, band: Band, shift: float = 0.0, anchor: float | None = None):
    """The sketch edge as a curve in the band's surface parameter space."""
    kind = edge.geom_type.name if hasattr(edge.geom_type, "name") else str(edge.geom_type)
    count = 1 if kind == "LINE" and band.linear else CURVE_SAMPLES
    uv = []
    for i in range(count + 1):
        p = edge.position_at(i / count)
        uv.append(band.to_param(p.X, p.Y))
    if band.periodic_u:  # keep the angle continuous from one sample to the next
        first = uv[0]
        if anchor is not None:  # start within half a turn of the rest of the outline
            first = (first[0] + band.periodic_u * round((anchor - first[0]) / band.periodic_u), first[1])
        fixed = [first]
        for u, v in uv[1:]:
            fixed.append((u + band.periodic_u * round((fixed[-1][0] - u) / band.periodic_u), v))
        uv = [(u + shift, v) for u, v in fixed]
    if count == 1:
        (ua, va), (ub, vb) = uv
        length = math.hypot(ub - ua, vb - va)
        if length < 1e-12:
            return None
        return Geom2d_TrimmedCurve(Geom2d_Line(gp_Pnt2d(ua, va), gp_Dir2d(ub - ua, vb - va)), 0, length)
    closed = math.hypot(uv[0][0] - uv[-1][0], uv[0][1] - uv[-1][1]) < 1e-9
    points = uv[:-1] if closed else uv  # a whole circle is interpolated as a periodic curve without repeating its start
    samples = HArray1_gp_Pnt2d(1, len(points))
    for i, (u, v) in enumerate(points):
        samples.SetValue(i + 1, gp_Pnt2d(u, v))
    interpolation = Geom2dAPI_Interpolate(samples, closed, 1e-9)
    interpolation.Perform()
    return interpolation.Curve()


def _anchor(wire, band: Band) -> float | None:
    """The angle of the outline's first point, which every edge is kept within half a turn of."""
    if not band.periodic_u:
        return None
    p = wire.edges()[0].position_at(0)
    return band.to_param(p.X, p.Y)[0]


def _wire(wire, band: Band, shift: float = 0.0, anchor: float | None = None):
    maker = BRepBuilderAPI_MakeWire()
    for edge in wire.edges():
        curve = _pcurve(edge, band, shift, anchor)
        if curve is not None:
            maker.Add(BRepBuilderAPI_MakeEdge(curve, band.surface).Edge())
    if not maker.IsDone():
        raise UnwrapError("Could not map the sketch outline onto the surface")
    return maker.Wire()


def _clip(zone: Face, polygon) -> list[Face]:
    """The part of a zone inside a polygon of the unrolled plane."""
    box = Face(Wire.make_polygon([(x, y, 0) for x, y in polygon], close=True))
    try:
        cut = zone.intersect(box)
    except Exception:
        return []
    return [f for f in (cut.faces() if cut is not None else []) if f.area > 1e-9]


def wrap_regions(shape, topology, face_ids, sketch: dict):
    """Imprint the closed regions of a sketch drawn on the unrolled faces onto those faces.
    Returns the new shape and the number of regions."""
    if isinstance(face_ids, int):
        face_ids = [face_ids]
    unrolling = build_unrolling(topology, list(face_ids))
    try:
        zones = regions(sketch)
    except SketchError as e:
        raise UnwrapError(str(e)) from e
    if not zones:
        raise UnwrapError("The sketch has no closed outline to wrap")
    ox, oy, oz = sketch["plane"].get("origin", [0, 0, 0])  # the plane may sit beside the model; zones are made in world space
    if ox or oy or oz:
        zones = [zone.moved(Location((-ox, -oy, -oz))) for zone in zones]
    tools = List_TopoDS_Shape()
    made = 0
    for zone in zones:
        for band in unrolling.bands:
            for k in band.copies:
                for piece in _clip(zone, band.clip(k)):
                    shift = -k * (band.periodic_u or 0.0)
                    anchor = _anchor(piece.outer_wire(), band)
                    maker = BRepBuilderAPI_MakeFace(band.surface, _wire(piece.outer_wire(), band, shift, anchor), True)
                    for inner in piece.inner_wires():
                        maker.Add(_wire(inner, band, shift, anchor).Reversed())
                    if not maker.IsDone():
                        raise UnwrapError("Could not make a face on the surface from this region")
                    mapped = maker.Face()
                    BRepLib.BuildCurves3d_s(mapped, 1e-6)
                    tools.Append(mapped)
                    made += 1
    if not made:
        raise UnwrapError("The sketch has no region on the unrolled faces")
    splitter = BRepAlgoAPI_Splitter()
    arguments = List_TopoDS_Shape()
    arguments.Append(shape)
    splitter.SetArguments(arguments)
    splitter.SetTools(tools)
    splitter.SetNonDestructive(True)
    splitter.Build()
    if not splitter.IsDone() or splitter.Shape().IsNull():
        raise UnwrapError("Could not imprint the sketch on the faces")
    return splitter.Shape(), len(zones)

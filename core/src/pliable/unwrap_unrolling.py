"""Building the flat layout of a cone, a cylinder chain or another surface: which faces unroll and where each lands on the plane."""

import math

from OCP.BRep import BRep_Tool
from OCP.BRepAdaptor import BRepAdaptor_Curve, BRepAdaptor_Surface
from OCP.BRepTools import BRepTools
from OCP.GeomAbs import GeomAbs_Cone, GeomAbs_Cylinder, GeomAbs_Line, GeomAbs_Plane
from OCP.gp import gp_Pnt, gp_Pnt2d
from OCP.ShapeAnalysis import ShapeAnalysis_Surface

from .unwrap_types import Band, TOL, Unrolling, UnwrapError
from .subshapes import edges_of as _edges, vertex_points
from .vecmath import dot as _dot


def _vertices(shape):
    return [(p.X(), p.Y(), p.Z()) for p in vertex_points(shape)]


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


# One face that cannot unroll exactly (sphere, torus, free-form) --------------------------------------


OUTLINE_SAMPLES = 24
GRID = 12


def _parametric_unrolling(face) -> Unrolling:
    """Flatten one face by laying out its own (u, v) parameters, each scaled by the typical length of a step in
    that direction. Lengths and angles are only approximately right (a sphere is stretched toward its poles);
    the worst length error over the face is reported as `distortion` so the sketch can say so."""
    from OCP.BRepClass import BRepClass_FaceClassifier
    from OCP.gp import gp_Pnt as Pnt, gp_Vec
    from OCP.TopAbs import TopAbs_IN

    surface = BRepAdaptor_Surface(face)
    u0, u1, v0, v1 = BRepTools.UVBounds_s(face)
    if not all(math.isfinite(x) for x in (u0, u1, v0, v1)):
        raise UnwrapError("This face has no finite extent to flatten")
    umid, vmid = (u0 + u1) / 2, (v0 + v1) / 2

    def derivatives(u, v):
        p, du, dv = Pnt(), gp_Vec(), gp_Vec()
        surface.D1(u, v, p, du, dv)
        return du.Magnitude(), dv.Magnitude(), du.Dot(dv)

    inside = []
    for i in range(GRID + 1):
        for j in range(GRID + 1):
            u, v = u0 + (u1 - u0) * i / GRID, v0 + (v1 - v0) * j / GRID
            classifier = BRepClass_FaceClassifier(face, gp_Pnt2d(u, v), 1e-7)
            if classifier.State() == TopAbs_IN:
                inside.append(derivatives(u, v) + (u, v))
    if not inside:
        raise UnwrapError("Could not sample this face to flatten it")
    # scale each direction by its median step so the flat outline is the right size where most of the face is
    su = sorted(d[0] for d in inside)[len(inside) // 2]
    sv = sorted(d[1] for d in inside)[len(inside) // 2]
    if su < 1e-9 or sv < 1e-9:
        raise UnwrapError("This face is too degenerate to flatten")
    worst = 0.0
    for du, dv, dot, _, _ in inside:
        if du < 1e-9 or dv < 1e-9:
            worst = max(worst, 1.0)
            continue
        worst = max(worst, abs(du / su - 1), abs(dv / sv - 1), abs(dot / (du * dv)))  # stretch each way, and shear

    def to_plane(u, v):
        return (u - umid) * su, (v - vmid) * sv

    def to_param(x, y):
        return umid + x / su, vmid + y / sv

    points: list[dict] = []
    entities: list[dict] = []

    def point(x, y):
        points.append({"id": len(points) + 1, "u": x, "v": y, "fixed": True})
        return len(points)

    for edge in _edges(face):
        curve = BRep_Tool.CurveOnSurface_s(edge, face, 0.0, 1.0)
        first, last = BRep_Tool.Range_s(edge, face)
        samples = [curve.Value(first + (last - first) * k / OUTLINE_SAMPLES) for k in range(OUTLINE_SAMPLES + 1)]
        ids = [point(*to_plane(p.X(), p.Y())) for p in samples]
        for a, b in zip(ids, ids[1:]):
            entities.append({"id": 1001 + len(entities), "type": "line", "a": a, "b": b, "construction": True, "reference": True})
    half_u, half_v = (u1 - u0) / 2 * su, (v1 - v0) / 2 * sv

    def clip(_k: int) -> list[tuple[float, float]]:
        return [(-half_u, -half_v), (half_u, -half_v), (half_u, half_v), (-half_u, half_v)]

    band = Band(face, BRep_Tool.Surface_s(face), -math.inf, math.inf, to_param, linear=False, clip=clip)
    percent = round(worst * 100)
    note = f"Approximate flattening: this face cannot be unrolled without stretching, so lengths and angles drawn here are off by up to {percent}% (most near the edges that squeeze together). Sizes are not exact when wrapped back."
    return Unrolling([band], {"points": points, "entities": entities}, faces=[face], distortion={"max": worst, "note": note})


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
    if len(faces) == 1 and _kind(faces[0]) not in (GeomAbs_Plane, GeomAbs_Cylinder):
        return _parametric_unrolling(faces[0])
    return _strip_unrolling(faces)

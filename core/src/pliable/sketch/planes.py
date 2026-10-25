"""Sketch planes: the frame of a plane, planes from faces, points and offsets, and the standard planes."""

import math

from OCP.gp import gp_Pnt, gp_Vec

from .errors import SketchError


def _unit(v) -> tuple[float, float, float]:
    length = math.sqrt(sum(c * c for c in v))
    if length < 1e-12:
        raise SketchError("The sketch plane has a zero-length axis")
    return tuple(c / length for c in v)


def _cross(a, b):
    return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])


def frame(plane: dict):
    """Origin, x, y and normal of a sketch plane as unit tuples (y = normal x x)."""
    normal = _unit(plane["normal"])
    xdir = plane.get("xdir")
    x = _unit(xdir) if xdir else _unit(_cross((0, 0, 1) if abs(normal[2]) < 0.9 else (1, 0, 0), normal))
    dot = sum(a * b for a, b in zip(x, normal))
    x = _unit(tuple(a - dot * b for a, b in zip(x, normal)))  # make x perpendicular to the normal
    y = _cross(normal, x)
    return tuple(plane["origin"]), x, y, normal


def _quaternion(x, y, z) -> tuple[float, float, float, float]:
    """Unit quaternion (w, x, y, z) of the rotation whose columns are the axes x, y, z."""
    m = [[x[0], y[0], z[0]], [x[1], y[1], z[1]], [x[2], y[2], z[2]]]
    trace = m[0][0] + m[1][1] + m[2][2]
    if trace > 0:
        s = math.sqrt(trace + 1) * 2
        w, qx, qy, qz = s / 4, (m[2][1] - m[1][2]) / s, (m[0][2] - m[2][0]) / s, (m[1][0] - m[0][1]) / s
    elif m[0][0] > m[1][1] and m[0][0] > m[2][2]:
        s = math.sqrt(1 + m[0][0] - m[1][1] - m[2][2]) * 2
        w, qx, qy, qz = (m[2][1] - m[1][2]) / s, s / 4, (m[0][1] + m[1][0]) / s, (m[0][2] + m[2][0]) / s
    elif m[1][1] > m[2][2]:
        s = math.sqrt(1 + m[1][1] - m[0][0] - m[2][2]) * 2
        w, qx, qy, qz = (m[0][2] - m[2][0]) / s, (m[0][1] + m[1][0]) / s, s / 4, (m[1][2] + m[2][1]) / s
    else:
        s = math.sqrt(1 + m[2][2] - m[0][0] - m[1][1]) * 2
        w, qx, qy, qz = (m[1][0] - m[0][1]) / s, (m[0][2] + m[2][0]) / s, (m[1][2] + m[2][1]) / s, s / 4
    return w, qx, qy, qz


def face_plane(face_shape) -> dict:
    """A sketch plane on a flat TopoDS face: the middle of the face's extent along the plane's own axes (the sketch
    origin sits at the centre of the face you see, not at its area centroid, which drifts toward the heavy side of
    an L shape or a face with holes), its outward normal and a direction in the plane."""
    from OCP.BRepAdaptor import BRepAdaptor_Surface
    from OCP.BRepTools import BRepTools

    from ..shared.faces import _plane_axes

    centre, normal, u, _ = _plane_axes(face_shape)
    u0, u1, v0, v1 = BRepTools.UVBounds_s(face_shape)
    middle = BRepAdaptor_Surface(face_shape).Value((u0 + u1) / 2, (v0 + v1) / 2)
    if middle.Distance(centre) < 1e6:  # a finite, sane extent (an unbounded surface keeps the centroid)
        centre = middle
    return {"origin": [centre.X(), centre.Y(), centre.Z()], "normal": [normal.X(), normal.Y(), normal.Z()], "xdir": [u.X(), u.Y(), u.Z()]}


def plane_normal_to(point, tangent) -> dict:
    """The sketch plane through `point` square to a direction (a line or curve's tangent there): its normal runs
    along the direction and its x axis is any direction square to it, chosen from the world axes so it is stable."""
    normal = _unit(tangent)
    reference = (0, 0, 1) if abs(normal[2]) < 0.9 else (1, 0, 0)
    return {"origin": list(point), "normal": list(normal), "xdir": list(_unit(_cross(reference, normal)))}


def plane_through(p1, p2, p3) -> dict:
    """The sketch plane through three points: origin at the first, x along the first to the second, normal by
    the right-hand rule from the first-to-second and first-to-third directions."""
    a = [q - o for q, o in zip(p2, p1)]
    b = [q - o for q, o in zip(p3, p1)]
    normal = _cross(a, b)
    if math.sqrt(sum(c * c for c in normal)) < 1e-9 * max(1.0, math.sqrt(sum(c * c for c in a)) * math.sqrt(sum(c * c for c in b))):
        raise SketchError("Those three points are in a line, so they do not define a plane")
    return {"origin": list(p1), "normal": list(_unit(normal)), "xdir": list(_unit(a))}


def rotate_plane(plane: dict, point, axis, degrees: float) -> dict:
    """The plane turned `degrees` about the line through `point` along `axis` (right-hand rule)."""
    k = _unit(axis)
    c, s = math.cos(math.radians(degrees)), math.sin(math.radians(degrees))

    def turn(v):
        cross = _cross(k, v)
        dot = sum(a * b for a, b in zip(k, v))
        return [v[i] * c + cross[i] * s + k[i] * dot * (1 - c) for i in range(3)]

    moved = turn([o - p for o, p in zip(plane["origin"], point)])
    return {**plane, "origin": [m + p for m, p in zip(moved, point)], "normal": list(_unit(turn(plane["normal"]))), "xdir": list(_unit(turn(plane["xdir"])))}


def shifted_plane(plane: dict, offset: float = 0.0, angle: float = 0.0, about=None) -> dict:
    """A plane parallel to `plane` moved `offset` along its normal, then turned `angle` degrees about `about`
    (a point and a direction; by default the plane's own x axis through its origin)."""
    moved = offset_plane(plane, offset) if offset else plane
    if not angle:
        return moved
    point, axis = about if about is not None else (moved["origin"], moved["xdir"])
    return rotate_plane(moved, point, axis, angle)


def tangent_plane(face_shape, point) -> dict:
    """The sketch plane touching a face at the spot nearest `point`: origin there, normal the face's outward normal."""
    from OCP.BRep import BRep_Tool
    from OCP.BRepGProp import BRepGProp_Face
    from OCP.GeomAPI import GeomAPI_ProjectPointOnSurf

    projection = GeomAPI_ProjectPointOnSurf(gp_Pnt(*point), BRep_Tool.Surface_s(face_shape))
    if projection.NbPoints() == 0:
        raise SketchError("That point is not on the face")
    u, v = projection.LowerDistanceParameters()
    at, normal = gp_Pnt(), gp_Vec()
    BRepGProp_Face(face_shape).Normal(u, v, at, normal)
    if normal.Magnitude() < 1e-12:
        raise SketchError("The face has no direction at that point")
    return plane_normal_to((at.X(), at.Y(), at.Z()), (normal.X(), normal.Y(), normal.Z()))


STANDARD_PLANES = {
    "XY": {"origin": [0, 0, 0], "normal": [0, 0, 1], "xdir": [1, 0, 0]},
    "XZ": {"origin": [0, 0, 0], "normal": [0, -1, 0], "xdir": [1, 0, 0]},
    "YZ": {"origin": [0, 0, 0], "normal": [1, 0, 0], "xdir": [0, 1, 0]},
}


def offset_plane(plane: dict, distance: float) -> dict:
    """The plane moved `distance` along its normal (a construction plane parallel to a standard one)."""
    n = plane["normal"]
    return {**plane, "origin": [o + distance * k for o, k in zip(plane["origin"], n)]}


def face_reference(face_shape, plane: dict, project: bool = False) -> dict:
    """The outline of a flat face as fixed construction geometry in sketch coordinates, so a sketch drawn on the
    face can snap to its corners and hole centres: {"points": [...], "entities": [...]} with ids from 1.
    With `project`, the edges of a whole shape are flattened onto the plane instead; lines square to the plane
    and edge-on circles become points or segments; a circle seen at an angle becomes an ellipse and other
    curves (tilted arcs, B-splines) become splines through sample points."""
    from OCP.BRepAdaptor import BRepAdaptor_Curve
    from OCP.GeomAbs import GeomAbs_Circle, GeomAbs_Ellipse, GeomAbs_Line
    from .projectellipse import ellipse_vectors, flattened_ellipse
    from OCP.BRep import BRep_Tool
    from OCP.TopAbs import TopAbs_EDGE, TopAbs_VERTEX
    from OCP.TopExp import TopExp_Explorer
    from OCP.TopoDS import TopoDS

    origin, x, y, normal = frame(plane)

    def uv(p) -> tuple[float, float]:
        d = (p.X() - origin[0], p.Y() - origin[1], p.Z() - origin[2])
        return sum(a * b for a, b in zip(d, x)), sum(a * b for a, b in zip(d, y))

    points: list[dict] = []
    entities: list[dict] = []
    by_key: dict[tuple[int, int], int] = {}

    def point(p) -> int:
        u, v = uv(p)
        key = (round(u * 1e5), round(v * 1e5))
        if key not in by_key:
            points.append({"id": len(points) + 1, "u": u, "v": v, "fixed": True})
            by_key[key] = len(points)
        return by_key[key]

    def add(entity: dict):
        entities.append({"id": len(points) + len(entities) + 1000, "construction": True, "reference": True, **entity})

    skipped = {"square": 0, "tilted_circles": 0, "other": 0}
    drawn = {"ellipses": 0, "splines": 0}

    def spline(curve, first: float, last: float, count: int) -> bool:
        """Add a fixed spline through `count` samples of the curve; False if it projects to (almost) a point or a
        back-and-forth segment, which a spline cannot describe."""
        samples = [curve.Value(first + (last - first) * i / (count - 1)) for i in range(count)]
        flat = [uv(p) for p in samples]
        span = max(math.dist(flat[0], q) for q in flat)
        if span < 1e-6:
            return False
        du, dv = flat[-1][0] - flat[0][0], flat[-1][1] - flat[0][1]
        if math.hypot(du, dv) > 1e-6 and max(abs(du * (q[1] - flat[0][1]) - dv * (q[0] - flat[0][0])) / math.hypot(du, dv) for q in flat) < 1e-6:
            return False  # collinear samples: the curve is seen edge-on
        ids = [point(p) for p in samples]
        closed = ids[0] == ids[-1]
        ids = [i for k, i in enumerate(ids) if k == 0 or i != ids[k - 1]]
        if closed:
            ids = ids[:-1]
        if len(ids) < 3 and closed:
            return False
        add({"type": "spline", "points": ids, **({"closed": True} if closed else {})})
        drawn["splines"] += 1
        return True

    def ellipse_edge(curve) -> bool:
        """Add the flattened true ellipse of a whole ellipse edge; False if it is seen edge-on."""
        ellipse = curve.Ellipse()
        major_vec, minor_vec = ellipse_vectors(ellipse)
        c = ellipse.Location()
        flat = flattened_ellipse((0.0, 0.0), major_vec, minor_vec, x, y)
        if flat is None:
            return False
        _, _, mu, mv, minor = flat
        cu, cv = uv(c)
        centre_id = point(c)
        tip = gp_Pnt(*(origin[i] + (cu + mu) * x[i] + (cv + mv) * y[i] for i in range(3)))
        add({"type": "ellipse", "center": centre_id, "major": point(tip), "minor": minor})
        drawn["ellipses"] += 1
        return True

    explorer = TopExp_Explorer(face_shape, TopAbs_EDGE)
    while explorer.More():
        curve = BRepAdaptor_Curve(TopoDS.Edge(explorer.Current()))
        first, last = curve.FirstParameter(), curve.LastParameter()
        if curve.GetType() == GeomAbs_Line:
            if project and math.dist(uv(curve.Value(first)), uv(curve.Value(last))) < 1e-6:
                skipped["square"] += 1  # seen end-on: it is the point its vertex projects to
                point(curve.Value(first))
                explorer.Next()
                continue
            add({"type": "line", "a": point(curve.Value(first)), "b": point(curve.Value(last))})
        elif curve.GetType() == GeomAbs_Circle:
            circle = curve.Circle()
            axis = circle.Axis().Direction()
            cosine = abs(axis.X() * normal[0] + axis.Y() * normal[1] + axis.Z() * normal[2])
            if project and abs(cosine - 1) > 1e-6:
                whole = abs((last - first) - 2 * math.pi) < 1e-6
                if cosine < 1e-3:  # the circle's plane is square to the sketch: it is seen edge-on
                    if whole:  # as the segment its diameter projects to
                        along = (axis.Y() * normal[2] - axis.Z() * normal[1], axis.Z() * normal[0] - axis.X() * normal[2], axis.X() * normal[1] - axis.Y() * normal[0])
                        length = math.sqrt(sum(c * c for c in along))
                        c0 = circle.Location()
                        ends = [gp_Pnt(*(c + sign * circle.Radius() * a / length for c, a in zip((c0.X(), c0.Y(), c0.Z()), along))) for sign in (1, -1)]
                        add({"type": "line", "a": point(ends[0]), "b": point(ends[1])})
                        skipped["square"] += 1
                    else:
                        skipped["tilted_circles"] += 1
                        for t in (first, last):
                            point(curve.Value(t))
                elif whole:  # a whole circle seen at an angle is an ellipse
                    # the major axis is the circle's diameter that lies in the plane: axis x normal
                    along = (axis.Y() * normal[2] - axis.Z() * normal[1], axis.Z() * normal[0] - axis.X() * normal[2], axis.X() * normal[1] - axis.Y() * normal[0])
                    length = math.sqrt(sum(c * c for c in along))
                    centre = circle.Location()
                    tip = gp_Pnt(*(c + circle.Radius() * a / length for c, a in zip((centre.X(), centre.Y(), centre.Z()), along)))
                    add({"type": "ellipse", "center": point(centre), "major": point(tip), "minor": circle.Radius() * cosine})
                    drawn["ellipses"] += 1
                else:  # a tilted arc is part of an ellipse: drawn as a spline through sample points
                    spline(curve, first, last, max(8, math.ceil(24 * (last - first) / (2 * math.pi)) + 1))
                explorer.Next()
                continue
            centre = point(circle.Location())
            if abs((last - first) - 2 * math.pi) < 1e-6:
                add({"type": "circle", "center": centre, "radius": circle.Radius()})
            else:
                start, end = curve.Value(first), curve.Value(last)
                cu, cv = uv(circle.Location())
                mid = uv(curve.Value((first + last) / 2))
                su, sv = uv(start)
                turn = (su - cu) * (mid[1] - cv) - (sv - cv) * (mid[0] - cu)
                if turn < 0:  # the edge runs clockwise in the sketch: swap so the arc is counterclockwise
                    start, end = end, start
                add({"type": "arc", "center": centre, "start": point(start), "end": point(end)})
        elif project and curve.GetType() == GeomAbs_Ellipse and abs((last - first) - 2 * math.pi) < 1e-6 and ellipse_edge(curve):
            pass  # a whole ellipse edge stays an ellipse
        elif project and spline(curve, first, last, 33):  # any other curve is sampled into a spline
            pass
        else:
            skipped["other"] += 1
            if project:
                for t in (first, last):
                    point(curve.Value(t))
        explorer.Next()
    if project:  # every vertex of the model is a snappable point, whether or not its edges could be drawn
        vertices = TopExp_Explorer(face_shape, TopAbs_VERTEX)
        while vertices.More():
            point(BRep_Tool.Pnt_s(TopoDS.Vertex(vertices.Current())))
            vertices.Next()
    if not project:  # the face centre, for centre-snapping and constraining a sketch to the middle of a face
        from OCP.BRepGProp import BRepGProp
        from OCP.GProp import GProp_GProps

        props = GProp_GProps()
        BRepGProp.SurfaceProperties_s(face_shape, props)
        if props.Mass() > 0:
            point(props.CentreOfMass())
    return {"points": points, "entities": entities, **({"skipped": skipped, "drawn": drawn} if project else {})}

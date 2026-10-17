"""Sketches on a plane with a geometric constraint solver (SolveSpace, via py-slvs).

A sketch is plain JSON, owned by the frontend; the core is stateless: `solve` takes a sketch and returns
the solved coordinates, `profile_face` turns closed loops into a planar face for extrusion.

    {"plane": {"origin": [x, y, z], "normal": [x, y, z], "xdir": [x, y, z]},
     "points": [{"id": 1, "u": 0, "v": 0}],
     "entities": [{"id": 10, "type": "line", "a": 1, "b": 2},
                  {"id": 11, "type": "circle", "center": 3, "radius": 5},
                  {"id": 12, "type": "arc", "center": 4, "start": 5, "end": 6}],   # arcs run counterclockwise
     "constraints": [{"id": 20, "type": "horizontal", "entity": 10},
                     {"id": 21, "type": "distance", "points": [1, 2], "value": 40}]}

Constraint types (arguments in brackets): coincident [points a, b]; point_on [point, entity]; horizontal and
vertical [entity line, or points a, b]; parallel, perpendicular, equal [entities a, b]; angle [entities a, b,
value in degrees]; tangent [entities a, b: arc/line or arc/arc]; distance [points a, b, value] or [entity line,
value]; radius and diameter [entity, value]; fixed [point]; midpoint [point, entity line]; symmetric
[points a, b, entity line].
"""

import math

from build123d import Edge, Face, Wire
from OCP.BRepBuilderAPI import BRepBuilderAPI_MakeEdge, BRepBuilderAPI_Transform
from OCP.gp import gp_Ax2, gp_Circ, gp_Dir, gp_Pnt, gp_Vec
from py_slvs import slvs

from .ops import OperationError

SOLVE_GROUP = 2  # entities in group 1 (the workplane) stay fixed; group 2 is solved
MIN_LOOP_AREA = 1e-9


class SketchError(OperationError):
    pass


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


class _Solver:
    def __init__(self, sketch: dict):
        self.sketch = sketch
        self.system = slvs.System()
        s = self.system
        origin, x, y, normal = frame(sketch["plane"])
        base = s.addPoint3dV(*origin, 1)
        self.workplane = s.addWorkplane(base, s.addNormal3dV(*_quaternion(x, y, normal), 1), 1)
        self.points = {p["id"]: s.addPoint2dV(self.workplane, p["u"], p["v"], SOLVE_GROUP) for p in sketch.get("points", [])}
        self.entities: dict[int, tuple[str, int]] = {}
        self.radii: dict[int, int] = {}
        for e in sketch.get("entities", []):
            self._add_entity(e)
        self.failed_ids: dict[int, int] = {}  # slvs constraint handle -> our constraint id

    def _point(self, pid):
        try:
            return self.points[pid]
        except KeyError:
            raise SketchError(f"Unknown point {pid}") from None

    def _add_entity(self, e: dict):
        s, g = self.system, SOLVE_GROUP
        kind = e["type"]
        if kind == "line":
            self.entities[e["id"]] = (kind, s.addLineSegment(self._point(e["a"]), self._point(e["b"]), g))
        elif kind == "circle":
            normal = s.addNormal2d(self.workplane, g)
            param = s.addParamV(e["radius"], g)
            self.radii[e["id"]] = param
            self.entities[e["id"]] = (kind, s.addCircle(self._point(e["center"]), normal, s.addDistance(param, g), g))
        elif kind == "arc":
            self.entities[e["id"]] = (kind, s.addArcOfCircle(self.workplane, self._point(e["center"]), self._point(e["start"]), self._point(e["end"]), g))
        else:
            raise SketchError(f"Unknown entity type {kind!r}")

    def _entity(self, eid, *kinds):
        try:
            kind, handle = self.entities[eid]
        except KeyError:
            raise SketchError(f"Unknown entity {eid}") from None
        if kinds and kind not in kinds:
            raise SketchError(f"Constraint needs a {' or '.join(kinds)}, got a {kind}")
        return handle

    def _coords(self, pid):
        e = self.system.getEntity(self.points[pid])
        return tuple(self.system.getParam(self.system.getEntityParam(self.points[pid], k)).val for k in range(2))

    def _arc_end_near(self, arc_id, line_id) -> bool:
        """For an arc-line or arc-arc tangency: True if the touching end is the arc's end point (else its start)."""
        entities = {e["id"]: e for e in self.sketch["entities"]}
        arc, other = entities[arc_id], entities[line_id]
        others = [other["a"], other["b"]] if other["type"] == "line" else [other["start"], other["end"]]
        gap = lambda a, b: math.dist(self._coords(a), self._coords(b))
        return min(gap(arc["end"], o) for o in others) < min(gap(arc["start"], o) for o in others)

    def add_constraint(self, c: dict):
        s, wp, g = self.system, self.workplane, SOLVE_GROUP
        kind = c["type"]
        points = [self._point(p) for p in c.get("points", [])]
        value = c.get("value")
        if kind == "coincident":
            h = s.addPointsCoincident(points[0], points[1], wp, g)
        elif kind == "point_on":
            target, handle = self.entities[c["entity"]]
            h = s.addPointOnLine(self._point(c["point"]), handle, wp, g) if target == "line" else s.addPointOnCircle(self._point(c["point"]), handle, g)
        elif kind in ("horizontal", "vertical"):
            if "entity" in c:
                line = self._entity(c["entity"], "line")
                h = (s.addLineHorizontal if kind == "horizontal" else s.addLineVertical)(line, wp, g)
            else:
                h = (s.addPointsHorizontal if kind == "horizontal" else s.addPointsVertical)(points[0], points[1], wp, g)
        elif kind in ("parallel", "perpendicular"):
            a, b = (self._entity(e, "line") for e in c["entities"])
            h = (s.addParallel if kind == "parallel" else s.addPerpendicular)(a, b, wp, g)
        elif kind == "equal":
            ka, ha = self.entities[c["entities"][0]]
            kb, hb = self.entities[c["entities"][1]]
            if ka == "line" and kb == "line":
                h = s.addEqualLength(ha, hb, wp, g)
            elif ka != "line" and kb != "line":
                h = s.addEqualRadius(ha, hb, g)
            else:
                raise SketchError("Equal needs two lines or two round entities")
        elif kind == "angle":
            a, b = (self._entity(e, "line") for e in c["entities"])
            h = s.addAngle(value, False, a, b, wp, g)
        elif kind == "tangent":
            (ka, ha), (kb, hb) = (self.entities[e] for e in c["entities"])
            ids = c["entities"]
            if "arc" in (ka, kb) and "line" in (ka, kb):
                arc_id, line_id = (ids[0], ids[1]) if ka == "arc" else (ids[1], ids[0])
                h = s.addArcLineTangent(self._arc_end_near(arc_id, line_id), self.entities[arc_id][1], self.entities[line_id][1], g)
            elif ka == "arc" and kb == "arc":
                h = s.addCurvesTangent(self._arc_end_near(ids[0], ids[1]), self._arc_end_near(ids[1], ids[0]), ha, hb, wp, g)
            else:
                raise SketchError("Tangent needs an arc and a line, or two arcs")
        elif kind == "distance":
            if "entity" in c:
                line = self.sketch_line(c["entity"])
                h = s.addPointsDistance(value, self._point(line["a"]), self._point(line["b"]), wp, g)
            else:
                h = s.addPointsDistance(value, points[0], points[1], wp, g)
        elif kind in ("radius", "diameter"):
            _, handle = self.entities[c["entity"]]
            h = s.addDiameter(value * (2 if kind == "radius" else 1), handle, g)
        elif kind == "fixed":
            h = s.addWhereDragged(self._point(c["point"]), wp, g)
        elif kind == "midpoint":
            h = s.addMidPoint(self._point(c["point"]), self._entity(c["entity"], "line"), wp, g)
        elif kind == "symmetric":
            h = s.addSymmetricLine(points[0], points[1], self._entity(c["entity"], "line"), wp, g)
        else:
            raise SketchError(f"Unknown constraint type {kind!r}")
        self.failed_ids[h] = c.get("id")

    def sketch_line(self, eid) -> dict:
        for e in self.sketch["entities"]:
            if e["id"] == eid and e["type"] == "line":
                return e
        raise SketchError(f"Entity {eid} is not a line")

    def solve(self) -> dict:
        code = self.system.solve(SOLVE_GROUP, True, False)
        failed = [self.failed_ids.get(h) for h in self.system.Failed]
        ok = code == 0
        points = []
        if ok:
            points = [{"id": pid, "u": self._coords(pid)[0], "v": self._coords(pid)[1]} for pid in self.points]
        radii = {eid: self.system.getParam(param).val for eid, param in self.radii.items()} if ok else {}
        return {"status": "ok" if ok else "failed", "code": code, "dof": self.system.Dof if ok else None, "failed": failed, "points": points, "radii": radii}


def solve(sketch: dict, drag: dict | None = None) -> dict:
    """Solve the sketch's constraints. `drag` = {"point": id, "u", "v"} holds one point where the pointer is
    (it is pinned there while everything else follows the constraints). On failure the points are unchanged."""
    solver = _Solver(sketch)
    for c in sketch.get("constraints", []):
        solver.add_constraint(c)
    if drag:
        pid = drag["point"]
        entity = solver._point(pid)
        for k, key in enumerate(("u", "v")):
            solver.system.getParam(solver.system.getEntityParam(entity, k)).val = drag[key]
        solver.add_constraint({"type": "fixed", "point": pid})
    return solver.solve()


def apply_solution(sketch: dict, result: dict) -> dict:
    """The sketch with the solver's coordinates and radii written back."""
    new = {**sketch, "points": [dict(p) for p in sketch.get("points", [])], "entities": [dict(e) for e in sketch.get("entities", [])]}
    solved = {p["id"]: p for p in result["points"]}
    for p in new["points"]:
        if p["id"] in solved:
            p["u"], p["v"] = solved[p["id"]]["u"], solved[p["id"]]["v"]
    for e in new["entities"]:
        if e["id"] in result["radii"]:
            e["radius"] = result["radii"][e["id"]]
    return new


# Profiles --------------------------------------------------------------------------------------------


def _edges(sketch: dict) -> list[Edge]:
    origin, x, y, normal = frame(sketch["plane"])
    points = {p["id"]: gp_Pnt(*(origin[k] + p["u"] * x[k] + p["v"] * y[k] for k in range(3))) for p in sketch.get("points", [])}
    def circle(center: gp_Pnt, radius: float) -> gp_Circ:
        return gp_Circ(gp_Ax2(center, gp_Dir(*normal), gp_Dir(*x)), radius)

    edges = []
    for e in sketch.get("entities", []):
        if e.get("construction"):
            continue
        try:
            if e["type"] == "line":
                a, b = points[e["a"]], points[e["b"]]
                if a.Distance(b) < 1e-9:
                    raise SketchError("A line has zero length")
                shape = BRepBuilderAPI_MakeEdge(a, b).Edge()
            elif e["type"] == "circle":
                shape = BRepBuilderAPI_MakeEdge(circle(points[e["center"]], e["radius"])).Edge()
            else:
                center, start, end = points[e["center"]], points[e["start"]], points[e["end"]]
                shape = BRepBuilderAPI_MakeEdge(circle(center, center.Distance(start)), start, end).Edge()
        except KeyError as missing:
            raise SketchError(f"Entity {e['id']} refers to a missing point {missing}") from None
        edges.append(Edge(shape))
    return edges


def profile_face(sketch: dict) -> Face:
    """One planar face from the sketch's closed loops; loops inside other loops become holes."""
    edges = _edges(sketch)
    if not edges:
        raise SketchError("The sketch has no geometry")
    wires = Wire.combine(edges)
    if not isinstance(wires, list):
        wires = [wires]
    if any(not w.is_closed for w in wires):
        raise SketchError("The sketch has an open loop: close every outline to make a profile")
    faces = sorted(((Face(w), w) for w in wires), key=lambda fw: -fw[0].area)
    if faces[-1][0].area < MIN_LOOP_AREA:
        raise SketchError("A loop in the sketch has no area")

    def inside(inner: Wire, outer: Face) -> bool:
        return outer.is_inside(inner.position_at(0.5))

    outers: list[tuple[Face, Wire]] = []
    holes: dict[int, list[Wire]] = {}
    for face, wire in faces:
        depth = sum(1 for other, _ in faces if other is not face and other.area > face.area and inside(wire, other))
        if depth % 2 == 0:
            outers.append((face, wire))
            holes[len(outers) - 1] = []
        else:
            parent = max((i for i, (of, _) in enumerate(outers) if of.area > face.area and inside(wire, of)), key=lambda i: -outers[i][0].area, default=None)
            if parent is not None:
                holes[parent].append(wire)
    if len(outers) > 1:
        raise SketchError("The sketch has several separate outlines; extrude them one at a time")
    (outer_face, outer_wire) = outers[0]
    return Face(outer_wire, holes[0]) if holes[0] else outer_face


def face_plane(face_shape) -> dict:
    """A sketch plane on a flat TopoDS face: its centre, outward normal and a direction in the plane."""
    from .features import _plane_axes

    centre, normal, u, _ = _plane_axes(face_shape)
    return {"origin": [centre.X(), centre.Y(), centre.Z()], "normal": [normal.X(), normal.Y(), normal.Z()], "xdir": [u.X(), u.Y(), u.Z()]}


STANDARD_PLANES = {
    "XY": {"origin": [0, 0, 0], "normal": [0, 0, 1], "xdir": [1, 0, 0]},
    "XZ": {"origin": [0, 0, 0], "normal": [0, -1, 0], "xdir": [1, 0, 0]},
    "YZ": {"origin": [0, 0, 0], "normal": [1, 0, 0], "xdir": [0, 1, 0]},
}


def extrude(shape, sketch: dict, distance: float, mode: str):
    """Extrude the sketch's profile along the plane normal and join it to the model (mode "join": positive
    distances go along the normal, so out of a face the sketch sits on) or cut it (mode "cut": into the material)."""
    from OCP.BRepPrimAPI import BRepPrimAPI_MakePrism

    from .features import _combine, finish

    if mode not in ("join", "cut"):
        raise SketchError("mode must be 'join' or 'cut'")
    if abs(distance) < 1e-4:
        raise SketchError("Give an extrusion distance")
    face = profile_face(sketch)
    _, _, _, normal = frame(sketch["plane"])
    direction = gp_Vec(*normal)
    if mode == "cut":
        # Start a hair above the plane so a face lying on the model is cut cleanly.
        margin = 1e-3 + 0.001 * abs(distance)
        lifted = BRepBuilderAPI_Transform(face.wrapped, _translation(direction.Multiplied(margin)), True).Shape()
        prism = BRepPrimAPI_MakePrism(lifted, direction.Multiplied(-(abs(distance) + margin)))
    else:
        prism = BRepPrimAPI_MakePrism(face.wrapped, direction.Multiplied(distance))
    prism.Build()
    if not prism.IsDone():
        raise SketchError("Could not extrude this profile")
    return finish(_combine(shape, prism.Shape(), fuse=mode == "join"))


def _translation(vector: gp_Vec):
    from OCP.gp import gp_Trsf

    t = gp_Trsf()
    t.SetTranslation(vector)
    return t

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
[points a, b, entity line]; collinear [entities a, b: lines]; point_line_distance [point, entity line, value]
(always measured as a positive distance, on whichever side the point is now); block [entity: all of its points
(and a circle's radius) stay where they are]; minor_radius [entity ellipse, value: its short semi-axis, which no
other constraint can reach]. A dimension with `"reference": true` is only a measurement and
is not solved.
"""

import math

from build123d import Edge, Face, Vector, Wire
from OCP.BRepBuilderAPI import BRepBuilderAPI_MakeEdge, BRepBuilderAPI_Transform
from OCP.gp import gp_Ax2, gp_Circ, gp_Dir, gp_Elips, gp_Pnt, gp_Vec
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


def _entity_point_ids(e: dict) -> list[int]:
    """Every point an entity is built from."""
    ids = [e[k] for k in ("a", "b", "center", "start", "end", "major") if k in e]
    return ids + list(e.get("points", []))


class _Solver:
    def __init__(self, sketch: dict):
        self.sketch = sketch
        self.system = slvs.System()
        s = self.system
        origin, x, y, normal = frame(sketch["plane"])
        base = s.addPoint3dV(*origin, 1)
        self.workplane = s.addWorkplane(base, s.addNormal3dV(*_quaternion(x, y, normal), 1), 1)
        self.points = {p["id"]: s.addPoint2dV(self.workplane, p["u"], p["v"], SOLVE_GROUP) for p in sketch.get("points", [])}
        for p in sketch.get("points", []):
            if p.get("fixed"):  # reference geometry from the model: never moves
                s.addWhereDragged(self.points[p["id"]], self.workplane, SOLVE_GROUP)
        self.entities: dict[int, tuple[str, int]] = {}
        self.radii: dict[int, int] = {}
        self.minors: dict[int, float] = {}  # ellipse id -> short semi-axis set by a minor_radius dimension
        for e in sketch.get("entities", []):
            self._add_entity(e)
        self.held: set[int] = set()  # points already pinned: pinning one twice is reported as a redundancy
        self.failed_ids: dict[int, int] = {}  # slvs constraint handle -> our constraint id
        self._axes: dict[str, int] = {}

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
        elif kind in ("ellipse", "spline"):
            for pid in ([e["center"], e["major"]] if kind == "ellipse" else e["points"]):
                self._point(pid)
            self.entities[e["id"]] = (kind, None)  # drawn from its points; only those points take part in constraints
        else:
            raise SketchError(f"Unknown entity type {kind!r}")

    def _entity(self, eid, *kinds):
        try:
            kind, handle = self.entities[eid]
        except KeyError:
            raise SketchError(f"Unknown entity {eid}") from None
        if kinds and kind not in kinds:
            raise SketchError(f"Constraint needs a {' or '.join(kinds)}, got a {kind}")
        if handle is None:
            raise SketchError(f"An {kind} takes no constraint of its own: constrain its points instead")
        return handle

    def _entity_kind(self, eid, kind):
        if self.entities.get(eid, (None,))[0] != kind:
            raise SketchError(f"Constraint needs a {kind}")

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
            round_kinds = {"arc", "circle"}
            if "circle" in (ka, kb) or not self._joined(*ids):
                if (ka in round_kinds or kb in round_kinds) and not (ka == "line" and kb == "line"):
                    for h in self._round_tangent(ids[0], ids[1], c.get("id")):
                        self.failed_ids[h] = c.get("id")
                    return
                raise SketchError("Tangent needs a circle or arc with a line, circle or arc")
            if "arc" in (ka, kb) and "line" in (ka, kb):
                arc_id, line_id = (ids[0], ids[1]) if ka == "arc" else (ids[1], ids[0])
                h = s.addArcLineTangent(self._arc_end_near(arc_id, line_id), self.entities[arc_id][1], self.entities[line_id][1], g)
            elif ka == "arc" and kb == "arc":
                h = s.addCurvesTangent(self._arc_end_near(ids[0], ids[1]), self._arc_end_near(ids[1], ids[0]), ha, hb, wp, g)
            else:
                raise SketchError("Tangent needs a circle or arc with a line, circle or arc")
        elif kind == "distance":
            if "entity" in c:
                line = self.sketch_line(c["entity"])
                h = s.addPointsDistance(value, self._point(line["a"]), self._point(line["b"]), wp, g)
            else:
                h = s.addPointsDistance(value, points[0], points[1], wp, g)
        elif kind in ("horizontal_distance", "vertical_distance"):
            horizontal = kind == "horizontal_distance"
            if "entity" in c:
                line = self.sketch_line(c["entity"])
                ids = [line["a"], line["b"]]
            else:
                ids = list(c["points"])
            axis = 0 if horizontal else 1
            if self._coords(ids[1])[axis] > self._coords(ids[0])[axis]:
                ids.reverse()  # SolveSpace measures the projection from the second point back to the first
            h = s.addPointsProjectDistance(value, self._point(ids[0]), self._point(ids[1]), self._axis_line(horizontal), g)
        elif kind in ("radius", "diameter"):
            handle = self._entity(c["entity"], "circle", "arc")
            h = s.addDiameter(value * (2 if kind == "radius" else 1), handle, g)
        elif kind == "fixed":
            if c["point"] in self.held:
                return
            self.held.add(c["point"])
            h = s.addWhereDragged(self._point(c["point"]), wp, g)
        elif kind == "midpoint":
            h = s.addMidPoint(self._point(c["point"]), self._entity(c["entity"], "line"), wp, g)
        elif kind == "symmetric":
            h = s.addSymmetricLine(points[0], points[1], self._entity(c["entity"], "line"), wp, g)
        elif kind == "minor_radius":
            self._entity_kind(c["entity"], "ellipse")
            self.minors[c["entity"]] = float(value)
            return
        elif kind == "collinear":
            a, b = (self.sketch_line(e) for e in c["entities"])
            handles = [s.addParallel(self._entity(a["id"], "line"), self._entity(b["id"], "line"), wp, g)]
            handles.append(s.addPointOnLine(self._point(b["a"]), self._entity(a["id"], "line"), wp, g))
            for h in handles:
                self.failed_ids[h] = c.get("id")
            return
        elif kind == "point_line_distance":
            line = self.sketch_line(c["entity"])
            (x0, y0), (x1, y1) = self._coords(line["a"]), self._coords(line["b"])
            px, py = self._coords(c["point"])
            side = (x1 - x0) * (py - y0) - (y1 - y0) * (px - x0)  # which side of the line the point is on now
            # the solver counts the distance positive to the right of the line's direction
            h = s.addPointLineDistance(abs(value) * (1 if side < 0 else -1), self._point(c["point"]), self._entity(c["entity"], "line"), wp, g)
        elif kind == "block":
            entity = next((e for e in self.sketch["entities"] if e["id"] == c["entity"]), None)
            if entity is None:
                raise SketchError(f"Unknown entity {c['entity']}")
            if entity["type"] == "circle":
                s.addDiameter(2 * entity["radius"], self._entity(entity["id"], "circle"), g)
            for pid in _entity_point_ids(entity):
                if pid not in self.held:
                    self.held.add(pid)
                    self.failed_ids[s.addWhereDragged(self._point(pid), wp, g)] = c.get("id")
            return
        else:
            raise SketchError(f"Unknown constraint type {kind!r}")
        self.failed_ids[h] = c.get("id")

    def _joined(self, id_a: int, id_b: int) -> bool:
        """Whether an arc's end point is shared (to within rounding) with an end point of the other entity."""
        entities = {e["id"]: e for e in self.sketch["entities"]}

        def ends(e):
            return [e["a"], e["b"]] if e["type"] == "line" else [e["start"], e["end"]] if e["type"] == "arc" else []

        return any(math.dist(self._coords(p), self._coords(q)) < 1e-6 for p in ends(entities[id_a]) for q in ends(entities[id_b]))

    def _round_tangent(self, id_a: int, id_b: int, constraint_id):
        """Tangency that SolveSpace has no direct constraint for (a circle, or an arc that does not share an end
        point), built from plain constraints.

        With a line: if a line end already lies on the round entity, its radius to that end is made perpendicular
        to the line; otherwise a hidden touching point on both, with the radius to it perpendicular to the line.
        With another round entity: a hidden touching point on both and on the line through the centres.
        """
        s, wp, g = self.system, self.workplane, SOLVE_GROUP
        entities = {e["id"]: e for e in self.sketch["entities"]}
        a, b = entities[id_a], entities[id_b]
        if a["type"] == "line":  # the round entity comes first
            a, b, id_a, id_b = b, a, id_b, id_a
        coords = {pid: self._coords(pid) for pid in self.points}
        centre = coords[a["center"]]
        radius = a["radius"] if a["type"] == "circle" else math.dist(centre, coords[a["start"]])
        handles = []
        if b["type"] == "line":
            on_round = [q for q in (b["a"], b["b"]) if abs(math.dist(coords[q], centre) - radius) < 1e-6 * (1 + radius)]
            if on_round:
                end = on_round[0]
                has_point_on = any(c.get("type") == "point_on" and c.get("point") == end and c.get("entity") == id_a for c in self.sketch.get("constraints", []))
                if not has_point_on:
                    handles.append(s.addPointOnCircle(self._point(end), self.entities[id_a][1], g))
                spoke = s.addLineSegment(self._point(a["center"]), self._point(end), g)
                handles.append(s.addPerpendicular(spoke, self.entities[id_b][1], wp, g))
                return handles
            p0, p1 = coords[b["a"]], coords[b["b"]]
            dx, dy = p1[0] - p0[0], p1[1] - p0[1]
            t = ((centre[0] - p0[0]) * dx + (centre[1] - p0[1]) * dy) / (dx * dx + dy * dy or 1.0)
            guess = (p0[0] + t * dx, p0[1] + t * dy)
        else:
            other = coords[b["center"]]
            d = math.dist(centre, other) or 1.0
            guess = (centre[0] + (other[0] - centre[0]) * radius / d, centre[1] + (other[1] - centre[1]) * radius / d)
        touch = s.addPoint2dV(wp, guess[0], guess[1], g)
        handles.append(s.addPointOnCircle(touch, self.entities[id_a][1], g))
        if b["type"] == "line":
            spoke = s.addLineSegment(self._point(a["center"]), touch, g)
            handles.append(s.addPointOnLine(touch, self.entities[id_b][1], wp, g))
            handles.append(s.addPerpendicular(spoke, self.entities[id_b][1], wp, g))
        else:
            through = s.addLineSegment(self._point(a["center"]), self._point(b["center"]), g)
            handles.append(s.addPointOnCircle(touch, self.entities[id_b][1], g))
            handles.append(s.addPointOnLine(touch, through, wp, g))
        return handles

    def _axis_line(self, horizontal: bool) -> int:
        """A fixed line along the sketch's u (or v) axis, to measure projected distances against."""
        key = "u" if horizontal else "v"
        if key not in self._axes:
            s = self.system
            a = s.addPoint2dV(self.workplane, 0, 0, 1)
            b = s.addPoint2dV(self.workplane, 1 if horizontal else 0, 0 if horizontal else 1, 1)
            self._axes[key] = s.addLineSegment(a, b, 1)
        return self._axes[key]

    def hold_axis(self, pid: int, axis: int) -> None:
        """Hold one coordinate (0 = u, 1 = v) of a point where it is: it is put on a fixed line through it."""
        s = self.system
        u, v = self._coords(pid)
        a = s.addPoint2dV(self.workplane, u, v, 1)
        b = s.addPoint2dV(self.workplane, u if axis == 0 else u + 1, v + 1 if axis == 0 else v, 1)
        s.addPointOnLine(self._point(pid), s.addLineSegment(a, b, 1), self.workplane, SOLVE_GROUP)

    def pin(self, pid: int, axis: int, want: float) -> int:
        """Hold one coordinate (0 = u, 1 = v) of a point at `want`; returns the constraint's handle."""
        s = self.system
        a = s.addPoint2dV(self.workplane, want if axis == 0 else 0.0, 0.0 if axis == 0 else want, 1)
        b = s.addPoint2dV(self.workplane, want if axis == 0 else 1.0, 1.0 if axis == 0 else want, 1)
        return s.addPointOnLine(self._point(pid), s.addLineSegment(a, b, 1), self.workplane, SOLVE_GROUP)

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
        if ok:
            radii.update(self.minors)  # an ellipse's short semi-axis travels with the radii
        return {"status": "ok" if ok else "failed", "code": code, "dof": self.system.Dof if ok else None, "failed": failed, "points": points, "radii": radii}


def _solved(sketch: dict, drag: dict | None = None, skip: int | None = None) -> tuple[_Solver, dict]:
    """A solver loaded with the sketch's constraints (all but `skip`) and the dragged points held, plus its result.

    Holding every coordinate of a dragged line can contradict its own constraints (a dimensioned or horizontal
    line moved by its body): then the last held coordinate that the solver blames is let go, and follows the
    constraints."""
    pins_wanted = []  # (point id, axis, wanted coordinate)
    if drag:
        # one point, or several held together ({"points": [...]}, e.g. both ends of a line dragged by its body)
        for h in drag["points"] if "points" in drag else [drag]:
            pins_wanted += [(h["point"], 0, h["u"]), (h["point"], 1, h["v"])]
    while True:
        solver = _Solver(sketch)
        for c in sketch.get("constraints", []):
            if (skip is None or c.get("id") != skip) and not c.get("reference"):
                solver.add_constraint(c)
        pins: dict[int, int] = {}  # slvs handle of a pin -> index in `pins_wanted`
        for k, (pid, axis, want) in enumerate(pins_wanted):
            entity = solver._point(pid)
            solver.system.getParam(solver.system.getEntityParam(entity, axis)).val = want
            if pid in solver.held:
                continue  # already fixed by a constraint: pinning it again is a redundancy
            pins[solver.pin(pid, axis, want)] = k
        result = solver.solve()
        if result["status"] == "ok" or len(pins_wanted) < 2:
            return solver, result
        blamed = [pins[h] for h in solver.system.Failed if h in pins]
        del pins_wanted[max(blamed, default=len(pins_wanted) - 1)]


def conflicting_constraints(sketch: dict) -> list[int]:
    """Ids of the constraints whose removal, alone, lets a failing sketch solve: the ones to blame. The solver
    itself names only the constraint it tripped over last, which may be an innocent one."""
    blamed = []
    for c in sketch.get("constraints", []):
        if c.get("id") is not None and _solved(sketch, skip=c["id"])[1]["status"] == "ok":
            blamed.append(c["id"])
    return blamed


def point_freedom(sketch: dict) -> dict[int, int]:
    """How many directions (0, 1 or 2) each point can still move in. The solver reports a redundancy when a
    point is held in a direction the constraints already fix, so holding the point one coordinate at a time, and
    then both, shows which are free. 0 means the constraints already place it."""
    freedom = {}
    for p in sketch.get("points", []):
        if p.get("fixed"):
            freedom[p["id"]] = 0
            continue

        def holds(axes) -> bool:
            solver = _Solver(sketch)
            for c in sketch.get("constraints", []):
                if not c.get("reference"):
                    solver.add_constraint(c)
            for axis in axes:
                solver.hold_axis(p["id"], axis)
            return solver.solve()["status"] == "ok"

        free = [axis for axis in (0, 1) if holds([axis])]
        freedom[p["id"]] = 1 if len(free) == 2 and not holds([0, 1]) else len(free)
    return freedom


MAX_DRAG_STEP = 0.05  # a drag longer than this fraction of the sketch's size is solved in steps
MAX_DRAG_STEPS = 12


def _extent(sketch: dict) -> float:
    pts = sketch.get("points", [])
    if not pts:
        return 1.0
    us, vs = [p["u"] for p in pts], [p["v"] for p in pts]
    return max(max(us) - min(us), max(vs) - min(vs), 1.0)


def _drag_steps(sketch: dict, drag: dict) -> list[dict]:
    """The drag split into smaller moves. The solver finds the solution nearest where the geometry is now, so a
    long jump can land on the other branch of a tangency or a mirrored corner; short steps follow the right one."""
    held = drag["points"] if "points" in drag else [drag]
    old = {p["id"]: p for p in sketch.get("points", [])}
    longest = max((math.dist((old[h["point"]]["u"], old[h["point"]]["v"]), (h["u"], h["v"])) for h in held if h["point"] in old), default=0.0)
    count = min(MAX_DRAG_STEPS, math.ceil(longest / (MAX_DRAG_STEP * _extent(sketch))))
    if count <= 1:
        return [drag]
    steps = []
    for k in range(1, count + 1):
        t = k / count
        moved = [{"point": h["point"], "u": old[h["point"]]["u"] + (h["u"] - old[h["point"]]["u"]) * t, "v": old[h["point"]]["v"] + (h["v"] - old[h["point"]]["v"]) * t} if h["point"] in old else h for h in held]
        steps.append({"points": moved})
    return steps


def solve(sketch: dict, drag: dict | None = None, detail: bool = False) -> dict:
    """Solve the sketch's constraints. `drag` = {"point": id, "u", "v"} holds one point where the pointer is
    (it is pinned there while everything else follows the constraints); {"points": [...]} holds several. On failure the points are unchanged.
    A long drag is solved in steps from where the geometry is now, so it follows the branch it started on; if a
    later step fails, the last step that worked is returned.

    `detail` adds what the sketch editor shows when nothing is being dragged: on success `freedom` (point id ->
    directions still free), on failure `conflicts` (constraint ids to blame)."""
    if not drag:
        result = _solved(sketch)[1]
        if detail:
            if result["status"] == "ok":
                result["freedom"] = point_freedom(sketch)
            else:
                result["conflicts"] = conflicting_constraints(sketch)
        return result
    current, result = sketch, None
    for step in _drag_steps(sketch, drag):
        attempt = _solved(current, step)[1]
        if attempt["status"] != "ok":
            if result is None:
                result = attempt
            break
        result = attempt
        current = apply_solution(current, attempt)
    if result["status"] == "ok":
        _keep_unconnected(sketch, drag, result)
    return result


def _connected_ids(sketch: dict, start: set[int]) -> set[int]:
    """Ids (points, entities) reachable from `start` through entities and constraints: the part of the sketch
    that dragging one of `start` may legitimately move."""
    links: list[set[int]] = []
    for e in sketch.get("entities", []):
        links.append({e["id"], *(e[k] for k in ("a", "b", "center", "start", "end", "major") if k in e), *e.get("points", [])})
    for c in sketch.get("constraints", []):
        group = {*c.get("points", []), *c.get("entities", [])}
        group.update(c[k] for k in ("point", "entity") if k in c)
        if len(group) > 1:
            links.append(group)
    reached = set(start)
    changed = True
    while changed:
        changed = False
        for group in links:
            if group & reached and not group <= reached:
                reached |= group
                changed = True
    return reached


def _keep_unconnected(sketch: dict, drag: dict, result: dict) -> None:
    """Whatever the solver did, geometry with no constraint path to the dragged points stays exactly where it was:
    unconstrained geometry moves freely and only what the constraints require follows."""
    held = {h["point"] for h in (drag["points"] if "points" in drag else [drag])}
    reached = _connected_ids(sketch, held)
    old = {p["id"]: p for p in sketch.get("points", [])}
    for q in result["points"]:
        if q["id"] not in reached and q["id"] in old:
            q["u"], q["v"] = old[q["id"]]["u"], old[q["id"]]["v"]
    for e in sketch.get("entities", []):
        if e["id"] not in reached and e["id"] in result["radii"] and ("radius" in e or "minor" in e):
            result["radii"][e["id"]] = e.get("radius", e.get("minor"))


def apply_solution(sketch: dict, result: dict) -> dict:
    """The sketch with the solver's coordinates and radii written back."""
    new = {**sketch, "points": [dict(p) for p in sketch.get("points", [])], "entities": [dict(e) for e in sketch.get("entities", [])]}
    solved = {p["id"]: p for p in result["points"]}
    for p in new["points"]:
        if p["id"] in solved:
            p["u"], p["v"] = solved[p["id"]]["u"], solved[p["id"]]["v"]
    for e in new["entities"]:
        if e["id"] in result["radii"]:
            e["minor" if e["type"] == "ellipse" else "radius"] = result["radii"][e["id"]]
    return new


# Profiles --------------------------------------------------------------------------------------------


def _ellipse_edge(center: gp_Pnt, major: gp_Pnt, minor: float, normal):
    """A whole ellipse about `center` whose major semi-axis runs to `major` and whose minor semi-axis is `minor`."""
    radius = center.Distance(major)
    if radius < 1e-9 or minor < 1e-9:
        raise SketchError("An ellipse needs a length on both axes")
    along = gp_Vec(center, major)
    if minor > radius:  # the longer axis is perpendicular to the one clicked
        along = gp_Vec(*normal).Crossed(along)
        radius, minor = minor, radius
    return BRepBuilderAPI_MakeEdge(gp_Elips(gp_Ax2(center, gp_Dir(*normal), gp_Dir(along)), radius, minor)).Edge()


def _edges(sketch: dict, skip: int | None = None) -> list[Edge]:
    origin, x, y, normal = frame(sketch["plane"])
    points = {p["id"]: gp_Pnt(*(origin[k] + p["u"] * x[k] + p["v"] * y[k] for k in range(3))) for p in sketch.get("points", [])}
    def circle(center: gp_Pnt, radius: float) -> gp_Circ:
        return gp_Circ(gp_Ax2(center, gp_Dir(*normal), gp_Dir(*x)), radius)

    edges = []
    for e in sketch.get("entities", []):
        if e.get("construction") or e["id"] == skip:
            continue
        try:
            if e["type"] == "line":
                a, b = points[e["a"]], points[e["b"]]
                if a.Distance(b) < 1e-9:
                    raise SketchError("A line has zero length")
                shape = BRepBuilderAPI_MakeEdge(a, b).Edge()
            elif e["type"] == "circle":
                shape = BRepBuilderAPI_MakeEdge(circle(points[e["center"]], e["radius"])).Edge()
            elif e["type"] == "ellipse":
                shape = _ellipse_edge(points[e["center"]], points[e["major"]], e["minor"], normal)
            elif e["type"] == "spline":
                through = [points[i] for i in e["points"]]
                if len(through) < 2:
                    raise SketchError("A spline needs at least two points")
                closed = bool(e.get("closed")) and len(through) > 2
                vectors = [Vector(p.X(), p.Y(), p.Z()) for p in through]
                shape = Edge.make_spline(vectors, periodic=closed).wrapped
            else:
                center, start, end = points[e["center"]], points[e["start"]], points[e["end"]]
                shape = BRepBuilderAPI_MakeEdge(circle(center, center.Distance(start)), start, end).Edge()
        except KeyError as missing:
            raise SketchError(f"Entity {e['id']} refers to a missing point {missing}") from None
        edges.append(Edge(shape))
    return edges


def profile_face(sketch: dict, skip: int | None = None) -> Face:
    """One planar face from the sketch's closed loops (construction lines and `skip` left out); loops inside
    other loops become holes."""
    edges = _edges(sketch, skip)
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


def offset_entities(sketch: dict, entity_ids: list[int], distance: float) -> dict:
    """Parallel copies of the selected lines, arcs and circles at `distance` (positive grows a closed outline,
    negative shrinks it; for an open chain positive is to the left of its direction). Returns the new points and
    entities (fresh ids, no constraints) for the caller to add."""
    from build123d import Kind

    chosen = [e for e in sketch.get("entities", []) if e["id"] in set(entity_ids)]
    if not chosen:
        raise SketchError("Select the lines, arcs or circles to offset")
    if abs(distance) < 1e-6:
        raise SketchError("Give an offset distance")
    picked = {**sketch, "entities": [{**e, "construction": False} for e in chosen]}
    wires = Wire.combine(_edges(picked))
    wires = wires if isinstance(wires, list) else [wires]
    origin, x, y, normal = frame(sketch["plane"])
    offset_wires = []
    for wire in wires:
        try:
            result = wire.offset_2d(distance, kind=Kind.ARC)
        except Exception as e:
            raise SketchError(f"Could not offset these curves by {distance:g}") from e
        offset_wires.extend(result if isinstance(result, list) else [result])
    ids = [p["id"] for p in sketch.get("points", [])] + [e["id"] for e in sketch.get("entities", [])] + [c["id"] for c in sketch.get("constraints", [])]
    next_id = max(ids, default=0) + 1
    points: list[dict] = []
    entities: list[dict] = []

    def uv(p) -> tuple[float, float]:
        d = [p.X - origin[0], p.Y - origin[1], p.Z - origin[2]]
        return sum(a * b for a, b in zip(d, x)), sum(a * b for a, b in zip(d, y))

    def new_point(p) -> int:
        nonlocal next_id
        u, v = uv(p)
        for q in points:  # edges of one wire meet at shared points
            if abs(q["u"] - u) < 1e-7 and abs(q["v"] - v) < 1e-7:
                return q["id"]
        points.append({"id": next_id, "u": u, "v": v})
        next_id += 1
        return next_id - 1

    def new_entity(entity: dict):
        nonlocal next_id
        entities.append({"id": next_id, **entity})
        next_id += 1

    for wire in offset_wires:
        edge_list = wire.edges()
        round_edges = [e for e in edge_list if (e.geom_type.name if hasattr(e.geom_type, "name") else str(e.geom_type)) == "CIRCLE"]
        if round_edges and len(round_edges) == len(edge_list) and wire.is_closed and all(
            (e.arc_center - round_edges[0].arc_center).length < 1e-7 and abs(e.radius - round_edges[0].radius) < 1e-7 for e in round_edges
        ):  # a whole circle comes back from the offset as two half arcs
            new_entity({"type": "circle", "center": new_point(round_edges[0].arc_center), "radius": round_edges[0].radius})
            continue
        for edge in edge_list:
            kind = edge.geom_type.name if hasattr(edge.geom_type, "name") else str(edge.geom_type)
            if kind == "LINE":
                new_entity({"type": "line", "a": new_point(edge.position_at(0)), "b": new_point(edge.position_at(1))})
            elif kind == "CIRCLE":
                centre = edge.arc_center
                if edge.is_closed or (edge.position_at(0) - edge.position_at(1)).length < 1e-7:
                    new_entity({"type": "circle", "center": new_point(centre), "radius": edge.radius})
                else:
                    start, middle, end = edge.position_at(0), edge.position_at(0.5), edge.position_at(1)
                    cross = (middle - start).cross(end - middle)
                    if cross.dot(Vector(*normal)) < 0:  # arcs run counterclockwise in the sketch
                        start, end = end, start
                    new_entity({"type": "arc", "center": new_point(centre), "start": new_point(start), "end": new_point(end)})
            else:
                raise SketchError("Offsetting this kind of curve is not supported yet")
    if not entities:
        raise SketchError(f"Could not offset these curves by {distance:g}")
    return {"points": points, "entities": entities}


def regions(sketch: dict) -> list[Face]:
    """Every distinct zone of the sketch's closed loops as a planar face: overlapping loops are split where
    they cross, and a loop inside another cuts a hole in it (the inner zone is a face of its own)."""
    from OCP.BOPAlgo import BOPAlgo_Builder
    from OCP.TopAbs import TopAbs_FACE
    from OCP.TopExp import TopExp_Explorer

    edges = _edges(sketch)
    if not edges:
        return []
    wires = Wire.combine(edges)
    if not isinstance(wires, list):
        wires = [wires]
    faces = [Face(w) for w in wires if w.is_closed]
    faces = [f for f in faces if f.area > MIN_LOOP_AREA]
    if not faces:
        return []
    split = faces[0].wrapped
    if len(faces) > 1:  # a single loop needs no splitting (and the algorithm wants two or more arguments)
        builder = BOPAlgo_Builder()
        for f in faces:
            builder.AddArgument(f.wrapped)
        builder.Perform()
        if builder.HasErrors():
            raise SketchError("Could not split the sketch into regions")
        split = builder.Shape()
    explorer = TopExp_Explorer(split, TopAbs_FACE)
    _, _, _, normal = frame(sketch["plane"])
    zones = []
    while explorer.More():
        zone = Face(explorer.Current())
        explorer.Next()
        if zone.normal_at().dot(Vector(*normal)) < 0:  # outward = along the sketch plane normal
            zone = Face(zone.wrapped.Reversed())
        zones.append(zone)
    return zones


def profile_meshes(sketch: dict) -> list[dict]:
    """The closed regions of a sketch as triangle meshes in world coordinates, for drawing them as view-only faces:
    [{"positions": [x, y, z, ...], "indices": [a, b, c, ...]}]. They are not part of any model."""
    from OCP.BRepMesh import BRepMesh_IncrementalMesh
    from OCP.BRep import BRep_Tool
    from OCP.TopLoc import TopLoc_Location

    out = []
    for zone in regions(sketch):
        BRepMesh_IncrementalMesh(zone.wrapped, 0.05, False, 0.3, True)
        triangulation = BRep_Tool.Triangulation_s(zone.wrapped, TopLoc_Location())
        if triangulation is None:
            continue
        reverse = zone.wrapped.Orientation().name == "TopAbs_REVERSED"
        positions = []
        for i in range(1, triangulation.NbNodes() + 1):
            p = triangulation.Node(i)
            positions += [p.X(), p.Y(), p.Z()]
        indices = []
        for i in range(1, triangulation.NbTriangles() + 1):
            a, b, c = triangulation.Triangle(i).Get()
            indices += [a - 1, c - 1, b - 1] if reverse else [a - 1, b - 1, c - 1]
        out.append({"positions": positions, "indices": indices})
    return out


def _host_face(shape, zone: Face):
    """A planar face of `shape` that contains the zone (same plane, zone inside it), or None."""
    from OCP.BRepAdaptor import BRepAdaptor_Surface
    from OCP.GeomAbs import GeomAbs_Plane
    from OCP.TopAbs import TopAbs_FACE
    from OCP.TopExp import TopExp_Explorer

    point = zone.center()  # inside for convex zones; fall back to a point on the wire
    probe = point if zone.is_inside(point) else zone.outer_wire().position_at(0.5)
    zone_normal = zone.normal_at()
    explorer = TopExp_Explorer(shape, TopAbs_FACE)
    while explorer.More():
        host = Face(explorer.Current())
        explorer.Next()
        surface = BRepAdaptor_Surface(host.wrapped)
        if surface.GetType() != GeomAbs_Plane:
            continue
        if abs(abs(host.normal_at().dot(zone_normal)) - 1) > 1e-6 or abs(host.distance_to(point) if False else (host.center() - point).dot(zone_normal)) > 1e-5:
            continue
        if host.is_inside(zone.outer_wire().position_at(0.25)) or host.is_inside(probe):
            return host
    return None


def add_regions(shape, sketch: dict, only: int | None = None):
    """Put the sketch's regions into the model so they can be picked: zones lying on a flat face of the model
    are imprinted on it (the face is split along their outline), the others are added as free faces. `only` picks
    one region by its index in `regions` (the order `profile_meshes` draws them in). Returns the new shape and how
    many regions became faces."""
    from OCP.BRep import BRep_Builder
    from OCP.BRepAlgoAPI import BRepAlgoAPI_Splitter
    from OCP.collections import List_TopoDS_Shape
    from OCP.TopoDS import TopoDS_Compound

    zones = regions(sketch)
    if not zones:
        raise SketchError("The sketch has no closed outline to make a face from")
    if only is not None:
        if not 0 <= only < len(zones):
            raise SketchError("That region of the sketch no longer exists")
        zones = [zones[only]]
    imprint, loose = [], []
    for zone in zones:
        (imprint if _host_face(shape, zone) is not None else loose).append(zone)
    result = shape
    if imprint:
        splitter = BRepAlgoAPI_Splitter()
        arguments, tools = List_TopoDS_Shape(), List_TopoDS_Shape()
        arguments.Append(shape)
        for zone in imprint:
            tools.Append(zone.wrapped)
        splitter.SetArguments(arguments)
        splitter.SetTools(tools)
        splitter.SetNonDestructive(True)
        splitter.Build()
        if splitter.IsDone() and not splitter.Shape().IsNull():
            result = splitter.Shape()
        else:
            loose.extend(imprint)
    if loose:
        compound, builder = TopoDS_Compound(), BRep_Builder()
        builder.MakeCompound(compound)
        builder.Add(compound, result)
        for zone in loose:
            builder.Add(compound, zone.wrapped)
        result = compound
    return result, len(zones)


def region_face(shape, sketch: dict, index: int):
    """The face of `shape` (the result of `add_regions` with `only=index`) that is the sketch's region `index`: the
    flat face in the region's plane with its area and centre, or None."""
    from OCP.TopAbs import TopAbs_FACE
    from OCP.TopExp import TopExp_Explorer

    zone = regions(sketch)[index]
    explorer = TopExp_Explorer(shape, TopAbs_FACE)
    while explorer.More():
        candidate = Face(explorer.Current())
        explorer.Next()
        if abs(candidate.area - zone.area) > 1e-6 * max(1.0, zone.area):
            continue
        if (candidate.center() - zone.center()).length < 1e-5 and abs(candidate.normal_at().dot(zone.normal_at())) > 1 - 1e-6:
            return candidate.wrapped
    return None


def face_plane(face_shape) -> dict:
    """A sketch plane on a flat TopoDS face: the middle of the face's extent along the plane's own axes (the sketch
    origin sits at the centre of the face you see, not at its area centroid, which drifts toward the heavy side of
    an L shape or a face with holes), its outward normal and a direction in the plane."""
    from OCP.BRepAdaptor import BRepAdaptor_Surface
    from OCP.BRepTools import BRepTools

    from .features import _plane_axes

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


def extrude(shape, sketch: dict, distance: float, mode: str, symmetric: bool = False):
    """Extrude the sketch's profile along the plane normal and join it to the model (mode "join": positive
    distances go along the normal, so out of a face the sketch sits on) or cut it (mode "cut": into the material)."""
    from OCP.BRepPrimAPI import BRepPrimAPI_MakePrism

    from .features import _add_material, _combine, finish

    if mode not in ("join", "cut", "new"):
        raise SketchError("mode must be 'join', 'cut' or 'new'")
    if abs(distance) < 1e-4:
        raise SketchError("Give an extrusion distance")
    face = profile_face(sketch)
    _, _, _, normal = frame(sketch["plane"])
    direction = gp_Vec(*normal)
    if symmetric:
        # Centred on the sketch plane: start half the distance behind it and run the full distance forward.
        start = BRepBuilderAPI_Transform(face.wrapped, _translation(direction.Multiplied(-abs(distance) / 2)), True).Shape()
        prism = BRepPrimAPI_MakePrism(start, direction.Multiplied(abs(distance)))
    elif mode == "cut":
        # Start a hair above the plane so a face lying on the model is cut cleanly.
        margin = 1e-3 + 0.001 * abs(distance)
        lifted = BRepBuilderAPI_Transform(face.wrapped, _translation(direction.Multiplied(margin)), True).Shape()
        prism = BRepPrimAPI_MakePrism(lifted, direction.Multiplied(-(abs(distance) + margin)))
    else:
        prism = BRepPrimAPI_MakePrism(face.wrapped, direction.Multiplied(distance))
    prism.Build()
    if not prism.IsDone():
        raise SketchError("Could not extrude this profile")
    return finish(_combine(shape, prism.Shape(), fuse=True) if mode == "join" else _add_material(shape, prism.Shape(), True) if mode == "new" else _combine(shape, prism.Shape(), fuse=False))


def _translation(vector: gp_Vec):
    from OCP.gp import gp_Trsf

    t = gp_Trsf()
    t.SetTranslation(vector)
    return t


def revolve(shape, sketch: dict, axis_entity: int, angle: float, mode: str):
    """Revolve the sketch's profile about one of its lines (`axis_entity`, which is left out of the profile) and
    join the result to the model (mode "join") or cut it from the model (mode "cut")."""
    from OCP.BRepPrimAPI import BRepPrimAPI_MakeRevol
    from OCP.gp import gp_Ax1

    from .features import _add_material, _combine, finish

    if mode not in ("join", "cut", "new"):
        raise SketchError("mode must be 'join', 'cut' or 'new'")
    if not 0.0 < abs(angle) <= 360.0:
        raise SketchError("The angle must be between 0 and 360 degrees")
    line = next((e for e in sketch.get("entities", []) if e["id"] == axis_entity and e["type"] == "line"), None)
    if line is None:
        raise SketchError("Pick a line in the sketch as the axis")
    origin, x, y, normal = frame(sketch["plane"])
    point = {p["id"]: gp_Pnt(*(origin[k] + p["u"] * x[k] + p["v"] * y[k] for k in range(3))) for p in sketch["points"]}
    a, b = point[line["a"]], point[line["b"]]
    if a.Distance(b) < 1e-9:
        raise SketchError("The axis line has zero length")
    face = profile_face(sketch, skip=axis_entity)
    revol = BRepPrimAPI_MakeRevol(face.wrapped, gp_Ax1(a, gp_Dir(gp_Vec(a, b))), math.radians(angle))
    revol.Build()
    if not revol.IsDone():
        raise SketchError("Could not revolve this profile (does it cross the axis?)")
    return finish(_combine(shape, revol.Shape(), fuse=True) if mode == "join" else _add_material(shape, revol.Shape(), True) if mode == "new" else _combine(shape, revol.Shape(), fuse=False))


def face_reference(face_shape, plane: dict, project: bool = False) -> dict:
    """The outline of a flat face as fixed construction geometry in sketch coordinates, so a sketch drawn on the
    face can snap to its corners and hole centres: {"points": [...], "entities": [...]} with ids from 1.
    With `project`, the edges of a whole shape are flattened onto the plane instead; lines square to the plane
    and edge-on circles become points or segments; a circle seen at an angle becomes an ellipse and other
    curves (tilted arcs, B-splines) become splines through sample points."""
    from OCP.BRepAdaptor import BRepAdaptor_Curve
    from OCP.GeomAbs import GeomAbs_Circle, GeomAbs_Line
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

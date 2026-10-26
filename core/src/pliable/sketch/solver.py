"""The constraint solver: solves a sketch and moves points under a drag."""

import math
import time

from py_slvs import slvs

from .errors import SketchError
from .symmetry import symmetric_about_line
from .planes import _quaternion, frame


SOLVE_GROUP = 2  # entities in group 1 (the workplane) stay fixed; group 2 is solved
MAX_COORDINATE = 1e9  # a solved point farther out than this (or not a number) means the solver diverged


def _entity_point_ids(e: dict) -> list[int]:
    """Every point an entity is built from."""
    ids = [e[k] for k in ("a", "b", "center", "start", "end", "major", "major2", "minor1", "minor2") if k in e]
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
        self.frames: dict[int, tuple] = {}  # ellipse id -> (centre, major end, opposite major end, minor end, opposite minor end) point handles
        self.foci: dict[int, tuple] = {}  # ellipse id -> its two focus points and the major axis (made when a point is put on the ellipse)
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
            for pid in (_entity_point_ids(e) if kind == "ellipse" else e["points"]):
                self._point(pid)
            self.entities[e["id"]] = (kind, None)  # drawn from its points; only those points take part in constraints
            if kind == "ellipse" and "minor1" in e:  # four axis ends: the centre is the middle of both axes, which are square to each other
                self._ellipse_frame(e)
        else:
            raise SketchError(f"Unknown entity type {kind!r}")

    def _coords_of(self, handle) -> tuple[float, float]:
        s = self.system
        return tuple(s.getParam(s.getEntityParam(handle, k)).val for k in range(2))

    def _ellipse_frame(self, e: dict) -> tuple:
        """The ellipse's centre, major end, opposite major end, minor end and opposite minor end as slvs points. An ellipse
        drawn with its four ends has them as sketch points; an older one (a centre, a major end and a minor radius) gets
        hidden ones. Either way the ends are held square to each other about the centre."""
        if e["id"] in self.frames:
            return self.frames[e["id"]]
        s, wp, g = self.system, self.workplane, SOLVE_GROUP
        centre, major = self._point(e["center"]), self._point(e["major"])
        if "minor1" in e:
            major2, minor1, minor2 = self._point(e["major2"]), self._point(e["minor1"]), self._point(e["minor2"])
        else:
            (cu, cv), (mu, mv) = self._coords(e["center"]), self._coords(e["major"])
            length = math.hypot(mu - cu, mv - cv) or 1.0
            b = self.minors.get(e["id"], e.get("minor", length))
            nu, nv = cu - (mv - cv) / length * b, cv + (mu - cu) / length * b
            major2 = s.addPoint2dV(wp, 2 * cu - mu, 2 * cv - mv, g)
            minor1, minor2 = s.addPoint2dV(wp, nu, nv, g), s.addPoint2dV(wp, 2 * cu - nu, 2 * cv - nv, g)
            s.addPointsDistance(b, centre, minor1, wp, g)
        major_axis, minor_axis = s.addLineSegment(major, major2, g), s.addLineSegment(minor1, minor2, g)
        s.addMidPoint(centre, major_axis, wp, g)
        s.addMidPoint(centre, minor_axis, wp, g)
        s.addPerpendicular(major_axis, minor_axis, wp, g)
        self.frames[e["id"]] = (centre, major, major2, minor1, minor2)
        return self.frames[e["id"]]

    def _point_on_ellipse(self, point, e: dict) -> int:
        """Put a point on an ellipse through its foci: the distances from the point to the two foci add up to the major
        width. A helper point q sits on the ray from the first focus through the point, as far from the point as the
        second focus is, and is held one major width from the first focus."""
        s, wp, g = self.system, self.workplane, SOLVE_GROUP
        centre, major, major2, minor1, minor2 = self._ellipse_frame(e)
        if e["id"] not in self.foci:
            (cu, cv), (mu, mv), (nu, nv) = self._coords_of(centre), self._coords_of(major), self._coords_of(minor1)
            a, b = math.hypot(mu - cu, mv - cv), math.hypot(nu - cu, nv - cv)
            # the foci lie on the longer axis, as far from the centre as the square root of the difference of the squares of the semi-axes
            if a >= b:
                far, far2, near, (du, dv) = major, major2, minor1, ((mu - cu) / (a or 1), (mv - cv) / (a or 1))
            else:
                far, far2, near, (du, dv) = minor1, minor2, major, ((nu - cu) / b, (nv - cv) / b)
            focal = math.sqrt(abs(a * a - b * b))
            f1 = s.addPoint2dV(wp, cu + du * focal, cv + dv * focal, g)
            f2 = s.addPoint2dV(wp, cu - du * focal, cv - dv * focal, g)
            long_axis = s.addLineSegment(far, far2, g)
            s.addPointOnLine(f1, long_axis, wp, g)
            s.addMidPoint(centre, s.addLineSegment(f1, f2, g), wp, g)
            # an end of the shorter axis is one semi-major length from each focus
            s.addEqualLength(s.addLineSegment(f1, near, g), s.addLineSegment(centre, far, g), wp, g)
            self.foci[e["id"]] = (f1, f2, long_axis)
        f1, f2, long_axis = self.foci[e["id"]]
        (pu, pv), (fu, fv), (gu, gv) = self._coords_of(point), self._coords_of(f1), self._coords_of(f2)
        reach = math.hypot(pu - fu, pv - fv) or 1.0
        beyond = math.hypot(pu - gu, pv - gv)
        q = s.addPoint2dV(wp, pu + (pu - fu) / reach * beyond, pv + (pv - fv) / reach * beyond, g)
        s.addPointOnLine(q, s.addLineSegment(f1, point, g), wp, g)
        s.addEqualLength(s.addLineSegment(point, q, g), s.addLineSegment(point, f2, g), wp, g)
        return s.addEqualLength(s.addLineSegment(f1, q, g), long_axis, wp, g)

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
        if kind in ("radius", "diameter", "minor_radius") and not (isinstance(value, (int, float)) and math.isfinite(value) and value > 0):
            raise SketchError("A radius or diameter must be a positive number")  # a circle of no size breaks everything built on it
        if kind == "coincident":
            h = s.addPointsCoincident(points[0], points[1], wp, g)
        elif kind == "point_on":
            target, handle = self.entities[c["entity"]]
            if target == "ellipse":
                h = self._point_on_ellipse(self._point(c["point"]), next(e for e in self.sketch["entities"] if e["id"] == c["entity"]))
            elif target == "spline":
                raise SketchError("A point cannot be put on a spline")
            else:
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
            h = s.addAngle(value, bool(c.get("outside")), a, b, wp, g)  # outside: the value is the supplement (the angle across the other pair of sectors)
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
        elif kind == "round_gap":
            for h in self._round_gap(c["entities"][0], c["entities"][1], float(value)):
                self.failed_ids[h] = c.get("id")
            return
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
        elif kind == "symmetric_point":  # the two points lie opposite each other about the third: it is the middle of the segment between them
            h = s.addMidPoint(self._point(c["point"]), s.addLineSegment(points[0], points[1], g), wp, g)
        elif kind == "symmetric":
            (au, av), (bu, bv) = (self._coords(i) for i in c["points"])
            for h in symmetric_about_line(s, points[0], points[1], self._entity(c["entity"], "line"), wp, g, ((au + bu) / 2, (av + bv) / 2)):
                self.failed_ids[h] = c.get("id")
            return
        elif kind == "minor_radius":
            self._entity_kind(c["entity"], "ellipse")
            ellipse = next(e for e in self.sketch["entities"] if e["id"] == c["entity"])
            if "minor1" in ellipse:  # the minor end is a point: the short radius is its distance from the centre
                h = s.addPointsDistance(float(value), self._point(ellipse["center"]), self._point(ellipse["minor1"]), wp, g)
            else:
                self.minors[c["entity"]] = float(value)
                return
        elif kind == "collinear":
            a, b = (self.sketch_line(e) for e in c["entities"])
            handles = [s.addParallel(self._entity(a["id"], "line"), self._entity(b["id"], "line"), wp, g)]
            if not {a["a"], a["b"]} & {b["a"], b["b"]}:  # lines that share an end point are already collinear once parallel; a point-on-line would repeat it
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

    def _round_gap(self, id_a: int, id_b: int, gap: float):
        """The spacing between two circles or arcs (the shortest way across the space between them): a hidden point on each,
        both on the line through the centres, and the distance between those points."""
        s, wp, g = self.system, self.workplane, SOLVE_GROUP
        entities = {e["id"]: e for e in self.sketch["entities"]}
        a, b = entities[id_a], entities[id_b]
        coords = {pid: self._coords(pid) for pid in self.points}

        def radius(e):
            return e["radius"] if e["type"] == "circle" else math.dist(coords[e["center"]], coords[e["start"]])

        ca, cb = coords[a["center"]], coords[b["center"]]
        ra, rb = radius(a), radius(b)
        d = math.dist(ca, cb)
        toward = ((cb[0] - ca[0]) / d, (cb[1] - ca[1]) / d) if d > 1e-9 else (1.0, 0.0)  # concentric: any direction gives the same gap
        if d <= abs(ra - rb):  # one inside the other: both points lie the same way from the centres, on the outer one's rim and the inner one's
            sign = 1.0 if ra >= rb else -1.0
            guess_a = (ca[0] + sign * toward[0] * ra, ca[1] + sign * toward[1] * ra)
            guess_b = (cb[0] + sign * toward[0] * rb, cb[1] + sign * toward[1] * rb)
        else:
            guess_a = (ca[0] + toward[0] * ra, ca[1] + toward[1] * ra)
            guess_b = (cb[0] - toward[0] * rb, cb[1] - toward[1] * rb)
        near_a = s.addPoint2dV(wp, guess_a[0], guess_a[1], g)
        near_b = s.addPoint2dV(wp, guess_b[0], guess_b[1], g)
        # The line the two points lie on: through both centres, or (concentric) out from the centre through the first point.
        through = s.addLineSegment(self._point(a["center"]), self._point(b["center"]) if d > 1e-9 else near_a, g)
        return [
            s.addPointOnCircle(near_a, self.entities[id_a][1], g),
            s.addPointOnCircle(near_b, self.entities[id_b][1], g),
            *([s.addPointOnLine(near_a, through, wp, g)] if d > 1e-9 else []),  # concentric: the line starts at the first point already
            s.addPointOnLine(near_b, through, wp, g),
            s.addPointsDistance(gap, near_a, near_b, wp, g),
        ]

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
            if not all(math.isfinite(p["u"]) and math.isfinite(p["v"]) and abs(p["u"]) < MAX_COORDINATE and abs(p["v"]) < MAX_COORDINATE for p in points):
                ok, code, points = False, -1, []  # a solution that flew off to infinity is a failure, never geometry
        radii = {eid: self.system.getParam(param).val for eid, param in self.radii.items()} if ok else {}
        if ok:
            radii.update(self.minors)  # an ellipse's short semi-axis travels with the radii
            for e in self.sketch.get("entities", []):
                if e["type"] == "ellipse" and "minor1" in e:
                    radii[e["id"]] = math.dist(self._coords(e["center"]), self._coords(e["minor1"]))
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


def point_freedom(sketch: dict, budget: float | None = None) -> dict[int, int]:
    """How many directions (0, 1 or 2) each point can still move in. The solver reports a redundancy when a
    point is held in a direction the constraints already fix, so holding the point one coordinate at a time, and
    then both, shows which are free. 0 means the constraints already place it.
    Each point takes several solves, so a big sketch is slow: with a `budget` (seconds) the points not reached in time are left out."""
    freedom = {}
    deadline = None if budget is None else time.monotonic() + budget
    whole = _Solver(sketch)
    for c in sketch.get("constraints", []):
        if not c.get("reference"):
            whole.add_constraint(c)
    result = whole.solve()
    if result["status"] == "ok" and result["dof"] == 0:
        return {p["id"]: 0 for p in sketch.get("points", [])}  # fully constrained: every point is placed, no need to test them one by one
    for p in sketch.get("points", []):
        if deadline is not None and time.monotonic() > deadline:
            break
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

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

from build123d import Edge, Face, Vector, Wire
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
        for p in sketch.get("points", []):
            if p.get("fixed"):  # reference geometry from the model: never moves
                s.addWhereDragged(self.points[p["id"]], self.workplane, SOLVE_GROUP)
        self.entities: dict[int, tuple[str, int]] = {}
        self.radii: dict[int, int] = {}
        for e in sketch.get("entities", []):
            self._add_entity(e)
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
            elif "circle" in (ka, kb):
                for h in self._circle_tangent(ids[0], ids[1]):
                    self.failed_ids[h] = c.get("id")
                return
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

    def _circle_tangent(self, id_a: int, id_b: int):
        """Tangency with a circle: a hidden touching point built from plain constraints.

        With a line the touching point lies on the line and on the circle, and the radius to it is
        perpendicular to the line. With a round entity it lies on both and on the line through the centres.
        """
        s, wp, g = self.system, self.workplane, SOLVE_GROUP
        entities = {e["id"]: e for e in self.sketch["entities"]}
        a, b = entities[id_a], entities[id_b]
        if a["type"] != "circle":
            a, b, id_a, id_b = b, a, id_b, id_a
        coords = {p["id"]: (p["u"], p["v"]) for p in self.sketch["points"]}
        for pid in self.points:
            coords[pid] = self._coords(pid)
        centre = coords[a["center"]]
        if b["type"] == "line":
            p0, p1 = coords[b["a"]], coords[b["b"]]
            dx, dy = p1[0] - p0[0], p1[1] - p0[1]
            t = ((centre[0] - p0[0]) * dx + (centre[1] - p0[1]) * dy) / (dx * dx + dy * dy or 1.0)
            guess = (p0[0] + t * dx, p0[1] + t * dy)
        else:
            other = coords[b["center"]]
            d = math.dist(centre, other) or 1.0
            guess = (centre[0] + (other[0] - centre[0]) * a["radius"] / d, centre[1] + (other[1] - centre[1]) * a["radius"] / d)
        touch = s.addPoint2dV(wp, guess[0], guess[1], g)
        handles = [s.addPointOnCircle(touch, self.entities[id_a][1], g)]
        if b["type"] == "line":
            radius = s.addLineSegment(self._point(a["center"]), touch, g)
            handles.append(s.addPointOnLine(touch, self.entities[id_b][1], wp, g))
            handles.append(s.addPerpendicular(radius, self.entities[id_b][1], wp, g))
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


def add_regions(shape, sketch: dict):
    """Put the sketch's regions into the model so they can be picked: zones lying on a flat face of the model
    are imprinted on it (the face is split along their outline), the others are added as free faces. Returns
    the new shape and how many regions became faces."""
    from OCP.BRep import BRep_Builder
    from OCP.BRepAlgoAPI import BRepAlgoAPI_Splitter
    from OCP.collections import List_TopoDS_Shape
    from OCP.TopoDS import TopoDS_Compound

    zones = regions(sketch)
    if not zones:
        raise SketchError("The sketch has no closed outline to make a face from")
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


def offset_plane(plane: dict, distance: float) -> dict:
    """The plane moved `distance` along its normal (a construction plane parallel to a standard one)."""
    n = plane["normal"]
    return {**plane, "origin": [o + distance * k for o, k in zip(plane["origin"], n)]}


def extrude(shape, sketch: dict, distance: float, mode: str, symmetric: bool = False):
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
    return finish(_combine(shape, prism.Shape(), fuse=mode == "join"))


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

    from .features import _combine, finish

    if mode not in ("join", "cut"):
        raise SketchError("mode must be 'join' or 'cut'")
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
    return finish(_combine(shape, revol.Shape(), fuse=mode == "join"))


def face_reference(face_shape, plane: dict, project: bool = False) -> dict:
    """The outline of a flat face as fixed construction geometry in sketch coordinates, so a sketch drawn on the
    face can snap to its corners and hole centres: {"points": [...], "entities": [...]} with ids from 1.
    With `project`, the edges of a whole shape are flattened onto the plane instead; lines square to the plane
    and circles or arcs seen at an angle (they would project to ellipses) are left out."""
    from OCP.BRepAdaptor import BRepAdaptor_Curve
    from OCP.GeomAbs import GeomAbs_Circle, GeomAbs_Line
    from OCP.TopAbs import TopAbs_EDGE
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

    explorer = TopExp_Explorer(face_shape, TopAbs_EDGE)
    while explorer.More():
        curve = BRepAdaptor_Curve(TopoDS.Edge(explorer.Current()))
        first, last = curve.FirstParameter(), curve.LastParameter()
        if curve.GetType() == GeomAbs_Line:
            if project and math.dist(uv(curve.Value(first)), uv(curve.Value(last))) < 1e-6:
                explorer.Next()
                continue
            add({"type": "line", "a": point(curve.Value(first)), "b": point(curve.Value(last))})
        elif curve.GetType() == GeomAbs_Circle:
            circle = curve.Circle()
            axis = circle.Axis().Direction()
            if project and abs(abs(axis.X() * normal[0] + axis.Y() * normal[1] + axis.Z() * normal[2]) - 1) > 1e-6:
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
        explorer.Next()
    if not project:  # the face centre, for centre-snapping and constraining a sketch to the middle of a face
        from OCP.BRepGProp import BRepGProp
        from OCP.GProp import GProp_GProps

        props = GProp_GProps()
        BRepGProp.SurfaceProperties_s(face_shape, props)
        if props.Mass() > 0:
            point(props.CentreOfMass())
    return {"points": points, "entities": entities}

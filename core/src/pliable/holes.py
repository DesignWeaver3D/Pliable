"""What a hole is, and how to find and rebuild one in a model that has no history.

A hole is a cut around one axis made of full cylinders and cones (plain, counterbore, countersink, stepped) and flat
shoulders, entering from a face and either running through the body or ending at a flat or conical bottom. Anything
else (a polygon, a slot, a partial round) is a pocket or slot, and has no hole description.

`find_hole(topology, face_id=..., edge_id=...)` starts from any face of a hole (wall, bottom, shoulder, countersink
cone) or from a circular rim edge and returns a `HoleInfo`: the axis (entry point and direction into the material),
diameter, depth or through, and the counterbore and countersink stages. `rebuild_hole` fills the old cut and cuts the
described hole again with changed values, which is how the hole tools edit one.
"""

import math
from dataclasses import dataclass, field

from OCP.BRep import BRep_Tool
from OCP.BRepAdaptor import BRepAdaptor_Curve, BRepAdaptor_Surface
from OCP.BRepBuilderAPI import BRepBuilderAPI_MakeFace, BRepBuilderAPI_MakePolygon
from OCP.BRepPrimAPI import BRepPrimAPI_MakeRevol
from OCP.BRepTools import BRepTools
from OCP.GeomAbs import GeomAbs_Circle, GeomAbs_Cone, GeomAbs_Cylinder, GeomAbs_Plane
from OCP.IntCurvesFace import IntCurvesFace_ShapeIntersector
from OCP.TopAbs import TopAbs_EDGE, TopAbs_REVERSED
from OCP.TopExp import TopExp_Explorer
from OCP.TopoDS import TopoDS
from OCP.gp import gp_Ax1, gp_Dir, gp_Lin, gp_Pnt, gp_Vec

from .ops import MIN_DISTANCE, OperationError

TOL = 1e-5
FULL_TURN = 2 * math.pi - 1e-6
NOT_ROUND = "That is a pocket or slot, not a round hole. Edit its faces directly (push/pull, move face), or select the round wall of a hole."


@dataclass
class _Segment:
    """One face of a hole in axis coordinates: s along the axis, r the distance from it, from (s0, r0) to (s1, r1)."""

    kind: str  # "cylinder", "cone" or "plane"
    face: int
    s0: float
    r0: float
    s1: float
    r1: float


@dataclass
class HoleInfo:
    faces: list[int]
    entry: gp_Pnt  # on the axis, in the plane of the opening
    direction: gp_Dir  # from the opening into the material
    diameter: float  # the main bore, the narrow part at the far end
    depth: float  # opening to the end of the main bore (to the shoulder of a conical bottom)
    through: bool
    bottom: str  # "through", "flat" or "cone"
    tip_angle: float = 0.0  # included angle of a conical bottom, degrees
    stages: list[dict] = field(default_factory=list)  # near the opening first: counterbore or countersink
    rim_edges: list[int] = field(default_factory=list)  # circular edges at the opening
    pass_length: float = 0.0  # opening to the far side of the body along the axis (the depth that means "through")

    @property
    def kind(self) -> str:
        names = [s["type"] for s in self.stages]
        return "counterbore" if "counterbore" in names else "countersink" if "countersink" in names else "plain"

    def point(self, s: float) -> gp_Pnt:
        return self.entry.Translated(gp_Vec(self.direction).Multiplied(s))

    @property
    def centre(self) -> gp_Pnt:
        return self.point(self.depth / 2)

    @property
    def end(self) -> gp_Pnt:
        return self.point(self.depth)

    def to_json(self) -> dict:
        def xyz(p):
            return [p.X(), p.Y(), p.Z()]

        return {
            "kind": self.kind,
            "faces": self.faces,
            "rimEdges": self.rim_edges,
            "entry": xyz(self.entry),
            "end": xyz(self.end),
            "centre": xyz(self.centre),
            "direction": [self.direction.X(), self.direction.Y(), self.direction.Z()],
            "diameter": self.diameter,
            "depth": self.depth,
            "through": self.through,
            "bottom": self.bottom,
            "tipAngle": self.tip_angle,
            "stages": self.stages,
            "passLength": self.pass_length,
        }


# ---- Reading the faces --------------------------------------------------------------------------------------------


def _axis_of(face):
    """(line, kind) of a face that has an axis: a cylinder or a cone; else None."""
    surface = BRepAdaptor_Surface(face)
    kind = surface.GetType()
    if kind == GeomAbs_Cylinder:
        return surface.Cylinder().Axis(), "cylinder"
    if kind == GeomAbs_Cone:
        return surface.Cone().Axis(), "cone"
    return None


def _on_axis(point: gp_Pnt, axis: gp_Ax1) -> bool:
    return gp_Lin(axis).Distance(point) < TOL * 10


def _parallel(a: gp_Dir, b: gp_Dir) -> bool:
    return abs(abs(a.Dot(b)) - 1) < 1e-7


def _inward(face) -> bool:
    """True when the face's material side points toward its axis (a hole wall), false for a boss."""
    surface = BRepAdaptor_Surface(face)
    u0, u1, v0, v1 = BRepTools.UVBounds_s(face)
    u, v = (u0 + u1) / 2, (v0 + v1) / 2
    point, du, dv = gp_Pnt(), gp_Vec(), gp_Vec()
    surface.D1(u, v, point, du, dv)
    normal = du.Crossed(dv)
    if face.Orientation() == TopAbs_REVERSED:
        normal.Reverse()
    axis = _axis_of(face)[0]
    along = gp_Vec(axis.Direction()).Multiplied(gp_Vec(axis.Location(), point).Dot(gp_Vec(axis.Direction())))
    radial = gp_Vec(axis.Location(), point).Subtracted(along)
    return normal.Dot(radial) < 0


def _is_round_wall(face) -> bool:
    """A full cylinder or cone whose material side faces the axis."""
    found = _axis_of(face)
    if found is None:
        return False
    u0, u1, _, _ = BRepTools.UVBounds_s(face)
    return u1 - u0 >= FULL_TURN and _inward(face)


def _circle_edges(face) -> list | None:
    """The circles bounding a flat face, or None if any boundary edge is not a full circle."""
    circles = []
    explorer = TopExp_Explorer(face, TopAbs_EDGE)
    while explorer.More():
        curve = BRepAdaptor_Curve(TopoDS.Edge(explorer.Current()))
        if curve.GetType() != GeomAbs_Circle:
            return None
        circles.append(curve.Circle())
        explorer.Next()
    return circles


def _floor_axis(topology, face):
    """The axis of a flat face that is the bottom or shoulder of a round hole (a disk or ring of circles that share
    one axis, every neighbour a hole wall), else None. The opening's own face and the top of a round post fail this."""
    surface = BRepAdaptor_Surface(face)
    if surface.GetType() != GeomAbs_Plane:
        return None
    circles = _circle_edges(face)
    if not circles:
        return None
    axis = circles[0].Axis()
    normal = surface.Plane().Axis().Direction()
    if not _parallel(axis.Direction(), normal) or any(not _on_axis(c.Location(), axis) for c in circles):
        return None
    explorer = TopExp_Explorer(face, TopAbs_EDGE)
    while explorer.More():
        for other in topology.edge_faces(TopoDS.Edge(explorer.Current())):
            if not other.IsSame(face) and not _is_round_wall(other):
                return None
        explorer.Next()
    return axis


def _coaxial_neighbour(topology, face, axis: gp_Ax1) -> bool:
    found = _axis_of(face)
    if found is not None:
        other = found[0]
        return _parallel(other.Direction(), axis.Direction()) and _on_axis(other.Location(), axis) and _is_round_wall(face)
    floor = _floor_axis(topology, face)
    return floor is not None and _parallel(floor.Direction(), axis.Direction()) and _on_axis(floor.Location(), axis)


def _segment(topology, face_id: int, face, axis: gp_Ax1) -> _Segment:
    origin, direction = axis.Location(), gp_Vec(axis.Direction())

    def local(p: gp_Pnt) -> tuple[float, float]:
        v = gp_Vec(origin, p)
        s = v.Dot(direction)
        return s, v.Subtracted(direction.Multiplied(s)).Magnitude()

    surface = BRepAdaptor_Surface(face)
    kind = surface.GetType()
    if kind == GeomAbs_Plane:
        circles = _circle_edges(face)
        s = local(surface.Plane().Location())[0]
        radii = sorted(c.Radius() for c in circles)
        return _Segment("plane", face_id, s, radii[0] if len(radii) > 1 else 0.0, s, radii[-1])
    u0, _, v0, v1 = BRepTools.UVBounds_s(face)
    (s0, r0), (s1, r1) = local(surface.Value(u0, v0)), local(surface.Value(u0, v1))
    if s0 > s1:
        s0, r0, s1, r1 = s1, r1, s0, r0
    return _Segment("cylinder" if kind == GeomAbs_Cylinder else "cone", face_id, s0, r0, s1, r1)


def _seed(topology, face_id: int | None, edge_id: int | None):
    """(face id, axis) of the first face around the selection that belongs to a round hole, else None."""
    if face_id is not None:
        candidates = [face_id]
    else:
        faces = topology.edge_faces(topology.edge(edge_id))
        candidates = [i for i in (topology.face_id(f) for f in faces) if i is not None]
    for cid in candidates:
        face = topology.face(cid)
        found = _axis_of(face)
        if found is not None and _is_round_wall(face):
            return cid, found[0]
        floor = _floor_axis(topology, face)
        if floor is not None:
            return cid, floor
    return None


def _pass_length(shape, entry: gp_Pnt, direction: gp_Dir, reach: float) -> float:
    """Distance from the opening to the far side of the body along the axis: the first place past the end of the
    cut (`reach`, including a conical bottom) where the axis leaves the material. Falls back to `reach`."""
    hits = IntCurvesFace_ShapeIntersector()
    hits.Load(shape, 1e-6)
    hits.Perform(gp_Lin(gp_Ax1(entry, direction)), -1e9, 1e9)
    beyond = sorted(hits.WParameter(i) for i in range(1, hits.NbPnt() + 1) if hits.WParameter(i) > reach + 1e-4)
    return beyond[0] if beyond else reach


def find_hole(topology, face_id: int | None = None, edge_id: int | None = None, reach: bool = True) -> HoleInfo:
    """The round hole that a face (wall, bottom, shoulder, countersink) or a circular rim edge belongs to.
    Raises OperationError with a plain message when the selection is not part of a round hole. `reach=False` skips the
    search for the far side of the body (`pass_length`), which is the only slow part."""
    seed = _seed(topology, face_id, edge_id)
    if seed is None:
        raise OperationError(NOT_ROUND)
    first, axis = seed
    members, queue = {first}, [first]
    while queue:
        face = topology.face(queue.pop())
        explorer = TopExp_Explorer(face, TopAbs_EDGE)
        while explorer.More():
            for other in topology.edge_faces(TopoDS.Edge(explorer.Current())):
                oid = topology.face_id(other)
                if oid is not None and oid not in members and _coaxial_neighbour(topology, other, axis):
                    members.add(oid)
                    queue.append(oid)
            explorer.Next()
    segments = sorted((_segment(topology, i, topology.face(i), axis) for i in members), key=lambda s: (s.s0, s.s1))
    walls = [s for s in segments if s.kind != "plane"]
    if not any(s.kind == "cylinder" for s in walls):
        raise OperationError("That is a tapered cut, not a plain round hole")
    lo = min(s.s0 for s in segments)
    hi = max(s.s1 for s in segments)

    def radius_at(end: float) -> float:
        return max([max(s.r0, s.r1) for s in segments if abs(s.s0 - end) < TOL or abs(s.s1 - end) < TOL] or [0.0])

    disks = [s for s in segments if s.kind == "plane" and s.r0 < TOL]
    tips = [s for s in walls if min(s.r0, s.r1) < TOL]
    # Which end is the opening: the end away from a bottom, else the end with the larger radius, else the low end.
    # flip = True means the opening is at the high-s end of the axis, so the hole runs toward lower s.
    if disks:
        flip = abs(disks[0].s0 - hi) >= TOL
    elif tips:
        flip = abs((tips[0].s0 if tips[0].r0 < TOL else tips[0].s1) - hi) >= TOL
    elif abs(radius_at(lo) - radius_at(hi)) > TOL:
        flip = radius_at(lo) < radius_at(hi)
    else:  # a plain through hole: let it run toward the negative side, like a hole drilled from a face that looks along +axis
        d = axis.Direction()
        flip = max((d.X(), d.Y(), d.Z()), key=abs) > 0
    sign = -1.0 if flip else 1.0
    s_entry = hi if flip else lo
    direction = axis.Direction() if not flip else axis.Direction().Reversed()
    entry = axis.Location().Translated(gp_Vec(axis.Direction()).Multiplied(s_entry))

    def along(s: float) -> float:
        return (s - s_entry) * sign

    ordered = []
    for seg in segments:
        a, b = (along(seg.s0), along(seg.s1))
        ra, rb = (seg.r0, seg.r1) if a <= b else (seg.r1, seg.r0)
        ordered.append(_Segment(seg.kind, seg.face, min(a, b), ra, max(a, b), rb))
    ordered.sort(key=lambda s: (s.s0, s.s1))
    cylinders = [s for s in ordered if s.kind == "cylinder"]
    main = cylinders[-1]
    stages = []
    for seg in ordered:
        if seg is not main and seg.kind != "plane" and seg.s1 <= main.s0 + TOL:
            if seg.kind == "cylinder" and seg.r0 > main.r0 + TOL:
                stages.append({"type": "counterbore", "diameter": 2 * seg.r0, "depth": seg.s1})
            elif seg.kind == "cone":
                dr, ds = abs(seg.r1 - seg.r0), seg.s1 - seg.s0
                stages.append({"type": "countersink", "diameter": 2 * max(seg.r0, seg.r1), "angle": math.degrees(2 * math.atan2(dr, ds)), "depth": seg.s1})
    through = not disks and not tips
    bottom = "through" if through else "cone" if tips else "flat"
    tip_angle = 0.0
    if tips:
        cone = tips[0]
        tip_angle = math.degrees(2 * math.atan2(abs(cone.r1 - cone.r0), cone.s1 - cone.s0))
    depth = main.s1
    rims = []
    for seg_face in members:
        explorer = TopExp_Explorer(topology.face(seg_face), TopAbs_EDGE)
        while explorer.More():
            edge = TopoDS.Edge(explorer.Current())
            curve = BRepAdaptor_Curve(edge)
            if curve.GetType() == GeomAbs_Circle and abs(gp_Vec(entry, curve.Circle().Location()).Dot(gp_Vec(direction))) < TOL * 10:
                eid = topology.edge_id(edge)
                if eid is not None and eid not in rims:
                    rims.append(eid)
            explorer.Next()
    info = HoleInfo(sorted(members), entry, direction, 2 * main.r0, depth, through, bottom, tip_angle, stages, sorted(rims))
    info.pass_length = depth if through or not reach else max(depth, _pass_length(topology.shape, entry, direction, max(s.s1 for s in ordered)))
    return info


# ---- Rebuilding ---------------------------------------------------------------------------------------------------


def hole_profile(info: HoleInfo, margin: float = 0.0, diameter: float | None = None, depth: float | None = None,
                 through: bool | None = None, stages: list[dict] | None = None) -> list[tuple[float, float]]:
    """The cross-section of a hole as (s, r) points from the axis at the opening round to the axis at the far end,
    `margin` longer than the opening (and, for a through hole, than the far end) so booleans cut cleanly."""
    radius = (info.diameter if diameter is None else diameter) / 2
    is_through = info.through if through is None else through
    length = info.depth if depth is None else depth
    steps = info.stages if stages is None else stages
    points: list[tuple[float, float]] = []

    def add(s: float, r: float):
        if not points or abs(points[-1][0] - s) > 1e-9 or abs(points[-1][1] - r) > 1e-9:
            points.append((s, r))

    end = length + (margin if is_through else 0.0)
    # Walk from the opening: each stage is wider than the bore and ends at its own depth.
    top = None
    for st in steps:
        if st["type"] == "countersink":
            half = math.radians(st["angle"]) / 2
            r_top = st["diameter"] / 2
            height = (r_top - radius) / math.tan(half)
            if height > 0:
                top = ("cone", r_top, height, half)
                break
        if st["type"] == "counterbore":
            top = ("bore", st["diameter"] / 2, st["depth"], 0.0)
            break
    if top is None:
        add(-margin, 0.0)
        add(-margin, radius)
    elif top[0] == "cone":
        _, r_top, height, half = top
        add(-margin, 0.0)
        add(-margin, r_top + margin * math.tan(half))
        add(height, radius)
    else:
        _, r_top, bore_depth, _ = top
        add(-margin, 0.0)
        add(-margin, r_top)
        add(bore_depth, r_top)
        add(bore_depth, radius)
    add(end, radius)
    if not is_through and info.bottom == "cone" and info.tip_angle > 0:
        add(end + radius / math.tan(math.radians(info.tip_angle) / 2), 0.0)
    else:
        add(end, 0.0)
    return points


def _revolved(info: HoleInfo, points: list[tuple[float, float]], offset: gp_Vec | None = None):
    """The solid made by turning a profile about the hole's axis."""
    d = gp_Vec(info.direction)
    seed = gp_Vec(0, 0, 1) if abs(d.Z()) < 0.9 else gp_Vec(1, 0, 0)
    x = d.Crossed(seed).Normalized()
    origin = info.entry if offset is None else info.entry.Translated(offset)
    polygon = BRepBuilderAPI_MakePolygon()
    for s, r in points:
        polygon.Add(origin.Translated(d.Multiplied(s)).Translated(x.Multiplied(r)))
    polygon.Close()
    face = BRepBuilderAPI_MakeFace(polygon.Wire()).Face()
    return BRepPrimAPI_MakeRevol(face, gp_Ax1(origin, info.direction), 2 * math.pi).Shape()


def hole_solid(info: HoleInfo, offset: gp_Vec | None = None, **changes):
    """The cut a hole makes exactly (to fill it), or with `changes` applied (`diameter`, `depth`, `through`, `stages`)."""
    return _revolved(info, hole_profile(info, 0.0, **changes), offset)


def rebuild_hole(shape, info: HoleInfo, offset: gp_Vec | None = None, **changes):
    """The model with this hole filled and cut again with changes (`diameter`, `depth`, `through`, `stages`) and moved
    by `offset`. Returns the new shape (not yet unified)."""
    from .features import _combine

    size = max(info.pass_length, info.depth, info.diameter)
    margin = 0.01 * size + 1e-3
    filled = _combine(shape, _revolved(info, hole_profile(info, 0.0)), fuse=True)
    new = _revolved(info, hole_profile(info, margin, **changes), offset)
    return _combine(filled, new, fuse=False)

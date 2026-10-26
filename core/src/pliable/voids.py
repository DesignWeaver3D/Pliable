"""Non-round through voids (squares, slots and other straight-walled cuts) and how to rebuild them.

A void here is a cut whose walls are all parallel to one axis (flat walls and cylinder parts, such as the ends of a slot),
closed into a loop, and either running through the body or ending at one flat floor. `find_void(topology, face_id)`
returns a `VoidInfo`: the axis (from the opening into the material), the profile at the opening as a wire, the depth, and
whether it goes through. `rebuild_void` fills the old cut and cuts the profile again, moved, offset (resized) or with
another depth, which is how the Edit cut tool edits one. Round holes are `holes.py`; a round bore is also a closed loop
of one cylinder, so the tool refuses voids that `find_hole` accepts."""

from dataclasses import dataclass, field

from OCP.BRep import BRep_Tool
from OCP.BRepAdaptor import BRepAdaptor_Curve, BRepAdaptor_Surface
from OCP.BRepBuilderAPI import BRepBuilderAPI_MakeFace, BRepBuilderAPI_MakeWire, BRepBuilderAPI_Transform
from OCP.BRepClass import BRepClass_FaceClassifier
from OCP.BRepClass3d import BRepClass3d_SolidClassifier
from OCP.BRepOffsetAPI import BRepOffsetAPI_MakeOffset
from OCP.BRepPrimAPI import BRepPrimAPI_MakePrism
from OCP.BRepTools import BRepTools
from OCP.GeomAbs import GeomAbs_Arc, GeomAbs_Cylinder, GeomAbs_Line, GeomAbs_Plane
from OCP.TopAbs import TopAbs_EDGE, TopAbs_IN, TopAbs_REVERSED, TopAbs_VERTEX, TopAbs_WIRE
from OCP.TopExp import TopExp_Explorer
from OCP.TopoDS import TopoDS
from OCP.gp import gp_Dir, gp_Pnt, gp_Trsf, gp_Vec

from .holes import _pass_length
from .ops import MIN_DISTANCE, OperationError, solids_of

TOL = 1e-5
NOT_A_VOID = "That is not a straight-walled cut (square, slot or similar) that goes through or ends at a flat floor"


@dataclass
class VoidInfo:
    faces: list[int]
    direction: gp_Dir  # from the opening into the material
    inside: gp_Pnt  # a point in the void, in the plane of the opening
    wire: object  # the profile at the opening
    depth: float  # opening to the far end (the floor, or the far side for a through void)
    through: bool
    pass_length: float  # opening to the far side of the body along the axis
    rim_edges: list[int] = field(default_factory=list)
    grip: gp_Pnt | None = None  # a point of the profile at the opening where the resize grip sits
    out: gp_Dir | None = None  # from there toward the material (the way the void grows)

    def point(self, s: float) -> gp_Pnt:
        return self.inside.Translated(gp_Vec(self.direction).Multiplied(s))


# ---- Reading the faces --------------------------------------------------------------------------------------------


def _line_direction(edge):
    curve = BRepAdaptor_Curve(edge)
    return curve.Line().Direction() if curve.GetType() == GeomAbs_Line else None


def _parallel(a: gp_Dir, b: gp_Dir) -> bool:
    return abs(abs(a.Dot(b)) - 1) < 1e-7


def _is_wall(face, d: gp_Dir) -> bool:
    surface = BRepAdaptor_Surface(face)
    kind = surface.GetType()
    if kind == GeomAbs_Plane:
        return abs(surface.Plane().Axis().Direction().Dot(d)) < 1e-7
    if kind == GeomAbs_Cylinder:
        return _parallel(surface.Cylinder().Axis().Direction(), d)
    return False


def _is_floor(face, d: gp_Dir) -> bool:
    surface = BRepAdaptor_Surface(face)
    return surface.GetType() == GeomAbs_Plane and _parallel(surface.Plane().Axis().Direction(), d)


def _edges(face):
    explorer = TopExp_Explorer(face, TopAbs_EDGE)
    while explorer.More():
        yield TopoDS.Edge(explorer.Current())
        explorer.Next()


def _vertices(shape):
    explorer = TopExp_Explorer(shape, TopAbs_VERTEX)
    while explorer.More():
        yield BRep_Tool.Pnt_s(TopoDS.Vertex(explorer.Current()))
        explorer.Next()


def _outward(face):
    """(point, normal) at the middle of a face: the normal points out of the material, so into a void wall's cut."""
    surface = BRepAdaptor_Surface(face)
    u0, u1, v0, v1 = BRepTools.UVBounds_s(face)
    point, du, dv = gp_Pnt(), gp_Vec(), gp_Vec()
    surface.D1((u0 + u1) / 2, (v0 + v1) / 2, point, du, dv)
    normal = du.Crossed(dv)
    if face.Orientation() == TopAbs_REVERSED:
        normal.Reverse()
    return point, gp_Dir(normal)


def _candidates(face) -> list[gp_Dir]:
    """Axis directions a face could belong to: its straight edges (a wall) or its normal (a floor)."""
    surface = BRepAdaptor_Surface(face)
    if surface.GetType() == GeomAbs_Cylinder:
        return [surface.Cylinder().Axis().Direction()]
    if surface.GetType() != GeomAbs_Plane:
        return []
    found: list[gp_Dir] = []
    for edge in _edges(face):
        d = _line_direction(edge)
        if d is not None and not any(_parallel(d, f) for f in found):
            found.append(d)
    return found + [surface.Plane().Axis().Direction()]  # a wall's own edges first; its normal only for a floor


def _flood(topology, d: gp_Dir, seeds: list[int]) -> set[int]:
    """The walls parallel to `d` joined to the seeds by edges along `d`."""
    members = set(seeds)
    queue = list(seeds)
    while queue:
        face = topology.face(queue.pop())
        for edge in _edges(face):
            along = _line_direction(edge)
            if along is None or not _parallel(along, d):
                continue
            for other in topology.edge_faces(edge):
                oid = topology.face_id(other)
                if oid is not None and oid not in members and _is_wall(other, d):
                    members.add(oid)
                    queue.append(oid)
    return members


def _closed(wire) -> bool:
    """True when every end point of the wire's edges joins exactly two edges."""
    count: dict[tuple, int] = {}
    explorer = TopExp_Explorer(wire, TopAbs_EDGE)
    while explorer.More():
        for p in _end_points(TopoDS.Edge(explorer.Current())):
            key = tuple(round(c, 5) for c in (p.X(), p.Y(), p.Z()))
            count[key] = count.get(key, 0) + 1
        explorer.Next()
    return bool(count) and all(n == 2 for n in count.values())


def _end_points(edge) -> list[gp_Pnt]:
    curve = BRepAdaptor_Curve(edge)
    return [curve.Value(curve.FirstParameter()), curve.Value(curve.LastParameter())]


def _ordered_wire(edges):
    """The wire of the edges, whatever order they come in (each added one must touch the wire), or None."""
    maker = BRepBuilderAPI_MakeWire()
    maker.Add(edges[0])
    left = list(edges[1:])
    while left:
        for edge in left:
            maker.Add(edge)
            if maker.IsDone():
                left.remove(edge)
                break
        else:
            return None
    wire = maker.Wire()
    return wire if _closed(wire) else None


def _wire_at(topology, members: set[int], d: gp_Dir, origin: gp_Pnt, s: float):
    """(wire, edge ids) of the member edges lying in the plane at distance `s` along `d`, or None when they do not close."""
    chosen, ids = [], []
    for fid in sorted(members):
        for edge in _edges(topology.face(fid)):
            along = _line_direction(edge)
            if along is not None and _parallel(along, d):
                continue
            points = list(_vertices(edge))
            if points and all(abs(gp_Vec(origin, p).Dot(gp_Vec(d)) - s) < TOL * 10 for p in points):
                eid = topology.edge_id(edge)
                if eid not in ids:
                    ids.append(eid)
                    chosen.append(edge)
    if len(chosen) < 2:
        return None
    wire = _ordered_wire(chosen)
    return (wire, ids) if wire is not None else None


def find_void(topology, face_id: int, reach: bool = True) -> VoidInfo:
    """The straight-walled void a face (a wall or its floor) belongs to; raises OperationError when it is none."""
    seed = topology.face(face_id)
    for axis in _candidates(seed):
        info = _try_axis(topology, face_id, seed, axis, reach)
        if info is not None:
            return info
    raise OperationError(NOT_A_VOID)


def _try_axis(topology, face_id, seed, axis: gp_Dir, reach: bool):
    seeds = [face_id] if _is_wall(seed, axis) else []
    if not seeds:  # a floor: its walls are the neighbours
        for edge in _edges(seed):
            for other in topology.edge_faces(edge):
                oid = topology.face_id(other)
                if oid is not None and oid != face_id and _is_wall(other, axis):
                    seeds.append(oid)
        if not seeds:
            return None
    members = _flood(topology, axis, seeds)
    origin = next(iter(_vertices(topology.face(seeds[0]))))

    def along(d, fid):
        return [gp_Vec(origin, p).Dot(gp_Vec(d)) for p in _vertices(topology.face(fid))]

    values = [v for fid in members for v in along(axis, fid)]
    if max(values) - min(values) < MIN_DISTANCE:
        return None
    # A flat floor closes one end: a plane across the axis whose edges are all shared with the walls.
    floor, floor_at = None, 0.0
    for fid in list(members):
        for edge in _edges(topology.face(fid)):
            for other in topology.edge_faces(edge):
                oid = topology.face_id(other)
                if oid is None or oid in members or not _is_floor(other, axis):
                    continue
                if all(topology.face_id(f) in members or topology.face_id(f) == oid for e in _edges(other) for f in topology.edge_faces(e)):
                    floor, floor_at = oid, along(axis, oid)[0]
    d = axis
    if floor is not None:
        if abs(floor_at - min(values)) < abs(floor_at - max(values)):
            d = axis.Reversed()  # point toward the floor
    elif max((axis.X(), axis.Y(), axis.Z()), key=abs) > 0:
        d = axis.Reversed()  # a through void runs toward the negative side, like a drilled hole
    values = [v for fid in members for v in along(d, fid)]
    entry_s, far_s = min(values), max(values)
    through = floor is None
    found = _wire_at(topology, members, d, origin, entry_s)
    if found is None:
        return None
    wire, rim = found
    if through:
        far = _wire_at(topology, members, d, origin, far_s)
        if far is None:
            return None
        for ids in (rim, far[1]):  # both ends must open onto a flat face across the axis, not a cone or step
            for eid in ids:
                for other in topology.edge_faces(topology.edge(eid)):
                    if topology.face_id(other) not in members and not _is_floor(other, d):
                        return None
    else:
        members.add(floor)
    made = BRepBuilderAPI_MakeFace(wire, True)
    if not made.IsDone():
        return None
    # The void must be the region the loop encloses: every wall's outward normal points into it (a boss points away).
    profile = made.Face()
    probe = None
    for fid in sorted(members - ({floor} if floor is not None else set())):
        point, normal = _outward(topology.face(fid))
        test = point.Translated(gp_Vec(normal).Multiplied(1e-3))
        test = test.Translated(gp_Vec(d).Multiplied(entry_s - gp_Vec(origin, test).Dot(gp_Vec(d))))
        classifier = BRepClass_FaceClassifier()
        classifier.Perform(profile, test, 1e-6)
        if classifier.State() != TopAbs_IN:
            return None
        if fid == seeds[0] or probe is None:
            probe = test
            seed_point, seed_normal = point, normal
    # ... and it must be empty space all the way along, which a wrong axis through solid material is not.
    middle = probe.Translated(gp_Vec(d).Multiplied((far_s - entry_s) / 2))
    for solid in solids_of(topology.shape):
        inside = BRepClass3d_SolidClassifier(solid, middle, 1e-6)
        if inside.State() == TopAbs_IN:
            return None
    pass_length = far_s - entry_s
    if not through and reach:
        pass_length = max(pass_length, _pass_length(topology.shape, probe, d, pass_length))
    grip = seed_point.Translated(gp_Vec(d).Multiplied(entry_s - gp_Vec(origin, seed_point).Dot(gp_Vec(d))))
    return VoidInfo(sorted(members), d, probe, wire, far_s - entry_s, through, pass_length, sorted(rim), grip, seed_normal.Reversed())


# ---- Rebuilding ---------------------------------------------------------------------------------------------------


def _translation(vector: gp_Vec) -> gp_Trsf:
    t = gp_Trsf()
    t.SetTranslation(vector)
    return t


def _prism(wire, d: gp_Dir, start: float, length: float):
    face = BRepBuilderAPI_MakeFace(wire, True).Face()
    moved = BRepBuilderAPI_Transform(face, _translation(gp_Vec(d).Multiplied(start)), True).Shape()
    return BRepPrimAPI_MakePrism(moved, gp_Vec(d).Multiplied(length)).Shape()


def offset_wire(wire, grow: float):
    """The profile grown by `grow` on every side (shrunk when negative), corners rounded for a growth."""
    if abs(grow) < MIN_DISTANCE:
        return wire
    maker = BRepOffsetAPI_MakeOffset(BRepBuilderAPI_MakeFace(wire, True).Face(), GeomAbs_Arc)
    maker.Perform(grow)
    explorer = TopExp_Explorer(maker.Shape(), TopAbs_WIRE) if maker.IsDone() else None
    if explorer is None or not explorer.More():
        raise OperationError("That size change would close the cut or leave nothing; use a smaller change")
    return TopoDS.Wire(explorer.Current())


def rebuild_void(shape, info: VoidInfo, offset: gp_Vec | None = None, grow: float = 0.0, depth: float | None = None, stretch: tuple[tuple[int, float], ...] = ()):
    """The model with this void filled and cut again, moved by `offset`, grown by `grow` and `depth` long (None keeps
    it; at least the whole pass means through) and `stretch` (world axis, distance) pairs that lengthen or shorten it along
    one axis (void_stretch.py). Returns the new shape (not yet unified)."""
    from .shared.solids import _combine

    margin = 0.01 * max(info.pass_length, info.depth) + 1e-3
    d = info.direction
    filled = _combine(shape, _prism(info.wire, d, 0.0, info.depth), fuse=True)
    wire = offset_wire(info.wire, grow)
    if offset is not None and offset.Magnitude() > 0:
        wire = TopoDS.Wire(BRepBuilderAPI_Transform(wire, _translation(offset), True).Shape())
    if depth is None:
        through, length = info.through, info.depth
    elif depth >= info.pass_length - MIN_DISTANCE:
        through, length = True, info.pass_length
    else:
        through, length = False, depth
    cut = _prism(wire, d, -margin, length + margin + (margin if through else 0.0))
    for axis, distance in stretch:
        from .void_stretch import stretch_solid

        cut = stretch_solid(cut, axis, distance)
    return _combine(filled, cut, fuse=False)

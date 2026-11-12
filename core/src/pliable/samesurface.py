"""Faces that lie on one surface become one face, whatever the kernel refused to merge.

The kernel's face merge (`ShapeUpgrade_UnifySameDomain`) joins two faces only when their surfaces are described alike:
the frame of a cylinder, cone, sphere or torus must start its angle at the same place and turn the same way. Faces of
one surface made by different operations are described differently, and stay split with a line between them.

Here the faces left split are found by comparing the surfaces themselves (type, size, position and which side is
outward, within a tolerance). The edges between faces of one surface are dropped, and one face is built from what is
left: the group's outer edges on the surface of one of its members, with the seam placed by the kernel's face repair.
A group is kept merged only when the solid is still valid and its volume and area are unchanged; otherwise the faces
stay as they were.
"""

from OCP.BRep import BRep_Builder, BRep_Tool
from OCP.BRepAdaptor import BRepAdaptor_Curve, BRepAdaptor_Surface
from OCP.BRepBuilderAPI import BRepBuilderAPI_MakeFace
from OCP.BRepGProp import BRepGProp, BRepGProp_Face
from OCP.collections import HSequence_TopoDS_Shape
from OCP.GeomAbs import GeomAbs_Cone, GeomAbs_Cylinder, GeomAbs_Plane, GeomAbs_Sphere, GeomAbs_Torus
from OCP.GeomAPI import GeomAPI_ProjectPointOnSurf
from OCP.gp import gp_Pnt, gp_Vec
from OCP.GProp import GProp_GProps
from OCP.ShapeAnalysis import ShapeAnalysis_FreeBounds
from OCP.ShapeBuild import ShapeBuild_ReShape
from OCP.ShapeFix import ShapeFix_Face
from OCP.TopAbs import TopAbs_EDGE, TopAbs_FACE, TopAbs_FORWARD, TopAbs_REVERSED, TopAbs_SOLID
from OCP.TopExp import TopExp_Explorer
from OCP.TopLoc import TopLoc_Location
from OCP.TopoDS import TopoDS, TopoDS_Face, TopoDS_Iterator, TopoDS_Shape

from .topology import Topology
from .validity import is_valid

LINEAR = 1e-6  # lengths (radius, offsets, distance of an axis) that count as equal
ANGULAR = 1e-9  # 1 - |cosine| of the angle between two directions that count as parallel
TOLERANCE = 1e-9  # the merged solid keeps its volume and area within this fraction
CONNECT = 1e-5  # edges this close at their ends form one outline

_TYPES = (GeomAbs_Plane, GeomAbs_Cylinder, GeomAbs_Cone, GeomAbs_Sphere, GeomAbs_Torus)


def _axis_line(axis):
    return axis.Location(), axis.Direction()


def _on_line(point, line_point, direction) -> bool:
    vector = gp_Vec(line_point, point)
    return vector.Crossed(gp_Vec(direction)).Magnitude() <= LINEAR


def _parallel(a, b) -> bool:
    return 1.0 - abs(a.Dot(b)) <= ANGULAR


def same_surface(a: BRepAdaptor_Surface, b: BRepAdaptor_Surface) -> bool:
    """Whether two surfaces are one surface in space (same type, size and position), however they are framed.
    Which side is outward is not compared here."""
    kind = a.GetType()
    if kind != b.GetType() or kind not in _TYPES:
        return False
    if kind == GeomAbs_Plane:
        pa, pb = a.Plane(), b.Plane()
        if not _parallel(pa.Axis().Direction(), pb.Axis().Direction()):
            return False
        return abs(gp_Vec(pa.Location(), pb.Location()).Dot(gp_Vec(pa.Axis().Direction()))) <= LINEAR
    if kind == GeomAbs_Sphere:
        sa, sb = a.Sphere(), b.Sphere()
        return abs(sa.Radius() - sb.Radius()) <= LINEAR and sa.Location().Distance(sb.Location()) <= LINEAR
    if kind == GeomAbs_Cylinder:
        ca, cb = a.Cylinder(), b.Cylinder()
        if abs(ca.Radius() - cb.Radius()) > LINEAR:
            return False
        point, direction = _axis_line(ca.Axis())
        return _parallel(direction, cb.Axis().Direction()) and _on_line(cb.Location(), point, direction)
    if kind == GeomAbs_Cone:
        ka, kb = a.Cone(), b.Cone()
        if abs(abs(ka.SemiAngle()) - abs(kb.SemiAngle())) > ANGULAR:
            return False
        apex_a, apex_b = ka.Apex(), kb.Apex()
        if apex_a.Distance(apex_b) > LINEAR:
            return False
        da, db = ka.Axis().Direction(), kb.Axis().Direction()
        # the cone opens along +axis for a positive semi-angle: the same cone has the same opening direction
        sign_a = da if ka.SemiAngle() > 0 else da.Reversed()
        sign_b = db if kb.SemiAngle() > 0 else db.Reversed()
        return 1.0 - sign_a.Dot(sign_b) <= ANGULAR
    ta, tb = a.Torus(), b.Torus()
    if abs(ta.MajorRadius() - tb.MajorRadius()) > LINEAR or abs(ta.MinorRadius() - tb.MinorRadius()) > LINEAR:
        return False
    return ta.Location().Distance(tb.Location()) <= LINEAR and _parallel(ta.Axis().Direction(), tb.Axis().Direction())


def _midpoint(edge):
    curve = BRepAdaptor_Curve(edge)
    return curve.Value(0.5 * (curve.FirstParameter() + curve.LastParameter()))


def _outward(face, point):
    """The outward normal of `face` (as oriented in its solid) at the place of its surface nearest `point`, or None."""
    projection = GeomAPI_ProjectPointOnSurf(point, BRep_Tool.Surface_s(face))
    if projection.NbPoints() == 0:
        return None
    u, v = projection.LowerDistanceParameters()
    place, vector = gp_Pnt(), gp_Vec()
    BRepGProp_Face(face).Normal(u, v, place, vector)
    if vector.Magnitude() < 1e-12:
        return None
    return vector.Normalized()


def _wire_edges(face):
    """The edges of the face's wires, each listed as many times as the wires use it."""
    found = []
    wires = TopoDS_Iterator(face)
    while wires.More():
        edges = TopoDS_Iterator(wires.Value())
        while edges.More():
            found.append(TopoDS.Edge(edges.Value()))
            edges.Next()
        wires.Next()
    return found


def _solids_of(shape: TopoDS_Shape, topology: Topology) -> dict[int, frozenset]:
    """For each face id, which solids (by position) hold the face; faces of different solids never merge."""
    members: dict[int, set] = {}
    solids = TopExp_Explorer(shape, TopAbs_SOLID)
    position = 0
    while solids.More():
        for _, face in Topology(solids.Current(), bodies=()).faces():
            members.setdefault(topology.face_id(face), set()).add(position)
        position += 1
        solids.Next()
    return {fid: frozenset(ids) for fid, ids in members.items()}


def _groups(shape: TopoDS_Shape, topology: Topology) -> list[list[TopoDS_Face]]:
    """Groups of two or more faces of `shape` that share edges and lie on one surface with the same side outward."""
    surfaces: dict[int, BRepAdaptor_Surface] = {}
    faces = {i: f for i, f in topology.faces()}

    def surface(i):
        if i not in surfaces:
            surfaces[i] = BRepAdaptor_Surface(faces[i], False)
        return surfaces[i]

    parent = {i: i for i in faces}

    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    owners = None
    linked = False
    for _, edge in topology.edges():
        around = {topology.face_id(f): f for f in topology.edge_faces(edge)}
        if len(around) != 2:
            continue
        (ia, fa), (ib, fb) = around.items()
        if find(ia) == find(ib) or surface(ia).GetType() != surface(ib).GetType() or surface(ia).GetType() not in _TYPES:
            continue
        if not same_surface(surface(ia), surface(ib)):
            continue
        point = _midpoint(edge)
        na, nb = _outward(fa, point), _outward(fb, point)
        if na is None or nb is None or na.Dot(nb) < 0.5:
            continue
        if owners is None:
            owners = _solids_of(shape, topology)
        if owners.get(ia) != owners.get(ib):
            continue
        parent[find(ia)] = find(ib)
        linked = True
    if not linked:
        return []
    groups: dict[int, list] = {}
    for i, face in faces.items():
        groups.setdefault(find(i), []).append(face)
    return [g for g in groups.values() if len(g) > 1]


def _edge_uses(group: list[TopoDS_Face]) -> list[list]:
    """Each edge of the group's faces with the number of times the group's wires use it (2 for an edge between two
    members, and for a seam)."""
    count: list[list] = []
    for face in group:
        for edge in _wire_edges(face):
            for entry in count:
                if entry[0].IsSame(edge):
                    entry[1] += 1
                    break
            else:
                count.append([edge, 1])
    return count


def _merged_face(group: list[TopoDS_Face], count: list[list], context: ShapeBuild_ReShape):
    """One face on the surface of the group's first face, bounded by the edges the group uses once, to stand in the
    place of the first face; None when it cannot be built. The repair tools may copy edges: `context` records that."""
    boundary = HSequence_TopoDS_Shape()
    for edge, uses in count:
        if uses == 1 and not BRep_Tool.Degenerated_s(edge):
            boundary.Append(edge)
    reference = TopoDS.Face(group[0].Oriented(TopAbs_FORWARD))
    surface = BRep_Tool.Surface_s(reference)
    if boundary.Length() == 0:
        # Nothing bounds the group: it is a whole closed surface (the faces of a sphere or torus cavity), which has natural bounds.
        if BRepAdaptor_Surface(reference, False).GetType() not in (GeomAbs_Sphere, GeomAbs_Torus):
            return None
        built = BRepBuilderAPI_MakeFace(surface, BRep_Tool.Tolerance_s(reference)).Face()
    else:
        wires = HSequence_TopoDS_Shape()
        ShapeAnalysis_FreeBounds.ConnectEdgesToWires_s(boundary, CONNECT, True, wires)
        builder = BRep_Builder()
        face = TopoDS_Face()
        # Not BRepBuilderAPI_MakeFace(surface) here: that gives the face the surface's natural bounds, the wires are the bounds.
        builder.MakeFace(face, surface, TopLoc_Location(), BRep_Tool.Tolerance_s(reference))
        for i in range(1, wires.Length() + 1):
            builder.Add(face, wires.Value(i))
        fixer = ShapeFix_Face(face)
        fixer.SetContext(context)
        fixer.FixMissingSeamMode = True  # a face all the way round a cylinder or cone has no seam yet
        fixer.Perform()
        built = fixer.Face()
    if built.IsNull():
        return None
    # the side that was outward on the old faces must be outward on the new one, in the place of the first old face
    for edge, uses in count:
        if not BRep_Tool.Degenerated_s(edge):
            point = _midpoint(edge)
            old, new = _outward(group[0], point), _outward(built, point)
            if old is None or new is None:
                return None
            if old.Dot(new) < 0:
                built = TopoDS.Face(built.Reversed())
            return TopoDS.Face(built.Reversed()) if group[0].Orientation() == TopAbs_REVERSED else built
    return None


def _measures(shape):
    volume, area = GProp_GProps(), GProp_GProps()
    BRepGProp.VolumeProperties_s(shape, volume)
    BRepGProp.SurfaceProperties_s(shape, area)
    return volume.Mass(), area.Mass()


class Merged:
    """The result of `merge_same_surface`: the new shape and a way to find where old faces, edges and vertices went."""

    def __init__(self, shape: TopoDS_Shape, context: ShapeBuild_ReShape, groups: list[list[TopoDS_Face]], counts: list[list[list]]):
        self.shape = shape
        self._context = context
        self._merged = []  # (member face, its group's first face)
        self._inside = []  # edges that went with the merge
        for group, count in zip(groups, counts):
            self._merged.extend((m, group[0]) for m in group)
            self._inside.extend(edge for edge, uses in count if uses > 1)
        self._present = Topology(shape, bodies=())

    def follow(self, items: list[TopoDS_Shape]) -> list[TopoDS_Shape]:
        found = []
        for item in items:
            if any(item.IsSame(edge) for edge in self._inside):
                continue
            first = next((g for member, g in self._merged if member.IsSame(item)), None)
            mapped = self._context.Apply((first if first is not None else item).Oriented(TopAbs_FORWARD))
            if not mapped.IsNull() and self._contains(mapped):
                found.append(mapped)
        return found

    def _contains(self, item) -> bool:
        kind = item.ShapeType()
        if kind == TopAbs_FACE:
            return self._present.face_id(item) is not None
        if kind == TopAbs_EDGE:
            return self._present.edge_id(item) is not None
        return self._present.vertex_id(item) is not None


def merge_same_surface(shape: TopoDS_Shape) -> Merged | None:
    """`shape` with every group of faces on one surface merged into one face; None when nothing merged. The groups are
    kept together when the result is valid and its volume and area are unchanged, else one by one (each only if it is)."""
    topology = Topology(shape, bodies=())
    groups = _groups(shape, topology)
    if not groups:
        return None
    before = _measures(shape)

    def attempt(chosen):
        context = ShapeBuild_ReShape()
        done, counts = [], []
        for group in chosen:
            count = _edge_uses(group)
            try:
                face = _merged_face(group, count, context)
            except Exception:  # an optional improvement: a group the repair tools cannot build stays split
                face = None
            if face is None:
                continue
            context.Replace(group[0].Oriented(TopAbs_FORWARD), face)
            for other in group[1:]:
                context.Remove(other.Oriented(TopAbs_FORWARD))
            done.append(group)
            counts.append(count)
        if not done:
            return None
        result = context.Apply(shape)
        if result.IsNull() or not is_valid(result):
            return None
        volume, area = _measures(result)
        if abs(volume - before[0]) > TOLERANCE * abs(before[0]) or abs(area - before[1]) > TOLERANCE * before[1]:
            return None
        return Merged(result, context, done, counts)

    merged = attempt(groups)
    if merged is None and len(groups) > 1:
        kept = [g for g in groups if attempt([g]) is not None]
        merged = attempt(kept) if kept else None
    return merged

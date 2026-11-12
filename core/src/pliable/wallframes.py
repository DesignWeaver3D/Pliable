"""Cylinder walls that continue each other are described the same way, so the kernel's face merge can join them.

A cylinder surface is described by a frame: an origin on the axis, the axis direction, and the direction where the
angle around the axis starts, with a turning sense. The kernel merges two faces of one cylinder only when their frames
agree apart from a shift along the axis. Pulling a face with holes makes new hole walls whose frame is the mirror image
of the walls they continue (the axis points the other way), and they stayed split.

Here such a wall is built again on a surface with its neighbor's frame. Nothing moves in space: a point at (u, v) on
the old surface is at (a + su*u, sv*v + d) on the new one, so the curves the wall's edges have on the surface are
moved by that rule. When the rule is a mirror image the surface's own outward side is the other one, so the wall's
edges run the other way round and the wall is put into the solid facing the other way.
"""

import math

from OCP.BRep import BRep_Builder, BRep_Tool
from OCP.BRepTools import BRepTools, BRepTools_ReShape
from OCP.Geom import Geom_CylindricalSurface
from OCP.gp import gp_Ax2d, gp_Dir2d, gp_Lin, gp_Pnt2d, gp_Trsf2d, gp_Vec, gp_Vec2d
from OCP.TopAbs import TopAbs_FORWARD, TopAbs_REVERSED
from OCP.TopLoc import TopLoc_Location
from OCP.TopoDS import TopoDS, TopoDS_Face, TopoDS_Iterator, TopoDS_Shape, TopoDS_Wire

from .topology import Topology

LINEAR = 1e-6
ANGULAR = 1e-9  # 1 - |cosine| of the angle between two axes that count as parallel
TURN = 2.0 * math.pi


def _cylinder(face):
    """The face's own cylinder surface in the model's coordinates (not a trimmed or swept one), or None."""
    surface = BRep_Tool.Surface_s(face)
    return surface if isinstance(surface, Geom_CylindricalSurface) else None


def _continues(a, b) -> bool:
    """Whether two cylinders are one cylinder in space, however their frames are laid out."""
    ca, cb = a.Cylinder(), b.Cylinder()
    if abs(ca.Radius() - cb.Radius()) > LINEAR:
        return False
    if 1.0 - abs(ca.Axis().Direction().Dot(cb.Axis().Direction())) > ANGULAR:
        return False
    return gp_Lin(ca.Axis()).Distance(cb.Location()) <= LINEAR


def _groups(shape: TopoDS_Shape) -> list[list[tuple]]:
    """The cylinder faces of `shape` in groups that share edges and lie on one cylinder; each member is (face, surface)."""
    topology = Topology(shape, bodies=())  # only the face and edge maps are used
    walls = {}
    for index, face in topology.faces():
        surface = _cylinder(face)
        if surface is not None:
            walls[index] = (face, surface)
    links: dict[int, set[int]] = {i: set() for i in walls}
    for _, edge in topology.edges():
        around = [i for i in (topology.face_id(f) for f in topology.edge_faces(edge)) if i in walls]
        for a in around:
            for b in around:
                if a < b and _continues(walls[a][1], walls[b][1]):
                    links[a].add(b)
                    links[b].add(a)
    groups, seen = [], set()
    for start in sorted(walls):
        if start in seen or not links[start]:
            continue
        group, queue = [], [start]
        seen.add(start)
        while queue:
            i = queue.pop()
            group.append(walls[i])
            for j in sorted(links[i] - seen):
                seen.add(j)
                queue.append(j)
        groups.append(group)
    return groups


def _rule(reference, surface):
    """How a point (u, v) of `surface` is found on a cylinder with the frame of `reference`: (a, su, sv, d) for
    (a + su*u, sv*v + d)."""
    fa, fb = reference.Position(), surface.Position()
    xa, ya, za = gp_Vec(fa.XDirection()), gp_Vec(fa.YDirection()), gp_Vec(fa.Direction())
    xb, yb, zb = gp_Vec(fb.XDirection()), gp_Vec(fb.YDirection()), gp_Vec(fb.Direction())
    sv = 1.0 if zb.Dot(za) > 0 else -1.0
    d = gp_Vec(fa.Location(), fb.Location()).Dot(za)
    a = math.atan2(xb.Dot(ya), xb.Dot(xa))
    su = 1.0 if yb.Dot(ya.Multiplied(math.cos(a)).Subtracted(xa.Multiplied(math.sin(a)))) > 0 else -1.0
    return a, su, sv, d


def _same_layout(rule) -> bool:
    a, su, sv, _ = rule
    return su > 0 and sv > 0 and abs(math.remainder(a, TURN)) < ANGULAR


def _rebuilt(face: TopoDS_Face, reference, rule) -> TopoDS_Face:
    """`face` built again on a cylinder with the frame of `reference` (see the module text); the result is the face as
    it goes into the solid in place of `face` taken forward."""
    a, su, sv, d = rule
    mirror = su * sv < 0
    location = TopLoc_Location()
    old = BRep_Tool.Surface_s(face, location)  # as stored: the edges' curves are filed under this pair
    forward = TopoDS.Face(face.Oriented(TopAbs_FORWARD))
    u_min, u_max, _, _ = BRepTools.UVBounds_s(forward)
    low = min(a + su * u_min, a + su * u_max)
    a -= TURN * math.floor((low + 1e-9) / TURN)  # the wall starts inside the first turn, as the kernel expects

    move = gp_Trsf2d()
    if su < 0 and sv < 0:
        move.SetRotation(gp_Pnt2d(0.0, 0.0), math.pi)
    elif sv < 0:
        move.SetMirror(gp_Ax2d(gp_Pnt2d(0.0, 0.0), gp_Dir2d(1.0, 0.0)))
    elif su < 0:
        move.SetMirror(gp_Ax2d(gp_Pnt2d(0.0, 0.0), gp_Dir2d(0.0, 1.0)))
    shift = gp_Trsf2d()
    shift.SetTranslation(gp_Vec2d(a, d))
    move = shift.Multiplied(move)

    surface = Geom_CylindricalSurface(reference.Position(), reference.Radius())
    nowhere = TopLoc_Location()
    builder = BRep_Builder()
    result = TopoDS_Face()
    builder.MakeFace(result, surface, nowhere, BRep_Tool.Tolerance_s(face))
    done = []
    wires = TopoDS_Iterator(forward)
    while wires.More():
        wire = TopoDS_Wire()
        builder.MakeWire(wire)
        edges = TopoDS_Iterator(wires.Value())
        while edges.More():
            edge = TopoDS.Edge(edges.Value())
            builder.Add(wire, edge.Reversed() if mirror else edge)
            if not any(edge.IsSame(e) for e in done):
                done.append(edge)
                plain = TopoDS.Edge(edge.Oriented(TopAbs_FORWARD))
                tolerance = BRep_Tool.Tolerance_s(plain)
                # Asked by surface, not by face: for a reversed face the kernel hands out a seam's two curves the other way round.
                first = BRep_Tool.CurveOnSurface_s(plain, old, location, 0.0, 0.0)
                if first is None:
                    raise ValueError("an edge of the wall has no curve on it")
                first = first.Transformed(move)
                if BRep_Tool.IsClosed_s(plain, old, location):  # the seam: one edge with a curve on each side of the wall
                    second = BRep_Tool.CurveOnSurface_s(TopoDS.Edge(plain.Reversed()), old, location, 0.0, 0.0).Transformed(move)
                    if mirror:  # the edge runs the other way round now, so its two sides change places
                        first, second = second, first
                    builder.UpdateEdge(plain, first, second, surface, nowhere, tolerance)
                else:
                    builder.UpdateEdge(plain, first, surface, nowhere, tolerance)
            edges.Next()
        wire.Closed(wires.Value().Closed())
        builder.Add(result, wire)
        wires.Next()
    return TopoDS.Face(result.Oriented(TopAbs_REVERSED if mirror else TopAbs_FORWARD))


def align_walls(shape: TopoDS_Shape) -> tuple[TopoDS_Shape, list[tuple[TopoDS_Shape, TopoDS_Shape]]] | None:
    """`shape` with every cylinder wall described like the wall it continues, and the (old face, new face) pairs;
    None when all walls already agree. The edges of a rebuilt wall get one more curve, so pass a copy that shares no
    edges with a shape still in use."""
    pairs = []
    for group in _groups(shape):
        reference = group[0][1]
        for face, surface in group[1:]:
            rule = _rule(reference, surface)
            if not _same_layout(rule):
                pairs.append((face, _rebuilt(face, reference, rule)))
    if not pairs:
        return None
    swap = BRepTools_ReShape()
    for old, new in pairs:
        swap.Replace(old.Oriented(TopAbs_FORWARD), new)
    return swap.Apply(shape), pairs

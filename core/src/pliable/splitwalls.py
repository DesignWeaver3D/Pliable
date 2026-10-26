"""Round walls whose cylinder is split into several faces (an imported or cut model that was never merged).

`wall_chain(topology, face_id)` returns the faces of the whole cylinder a face belongs to: one face for an ordinary full
wall, several for a split one, and an empty list when the face is only part of a cylinder (a fillet or a slot end)."""

import math

from OCP.BRepAdaptor import BRepAdaptor_Surface
from OCP.BRepTools import BRepTools
from OCP.GeomAbs import GeomAbs_Cylinder
from OCP.TopAbs import TopAbs_EDGE
from OCP.TopExp import TopExp_Explorer
from OCP.TopoDS import TopoDS
from OCP.gp import gp_Lin, gp_Vec

FULL = 2 * math.pi - 1e-6
TOL = 1e-6


def _cylinder_of(face):
    surface = BRepAdaptor_Surface(face)
    if surface.GetType() != GeomAbs_Cylinder:
        return None
    return surface.Cylinder()


def _same_cylinder(a, b) -> bool:
    return (
        abs(a.Radius() - b.Radius()) < 1e-6
        and a.Axis().Direction().IsParallel(b.Axis().Direction(), 1e-7)
        and gp_Lin(a.Axis()).Distance(b.Axis().Location()) < 1e-5
    )


def wall_chain(topology, face_id: int) -> list[int]:
    """Ids of the faces that together make the full cylinder of `face_id`, or [] when they do not close a full turn."""
    first = topology.face(face_id)
    cylinder = _cylinder_of(first)
    if cylinder is None:
        return []
    _, _, v0, v1 = BRepTools.UVBounds_s(first)
    members, queue, sweep = [face_id], [face_id], 0.0
    while queue:
        current = topology.face(queue.pop())
        u0, u1, _, _ = BRepTools.UVBounds_s(current)
        sweep += u1 - u0
        explorer = TopExp_Explorer(current, TopAbs_EDGE)
        while explorer.More():
            for other in topology.edge_faces(TopoDS.Edge(explorer.Current())):
                oid = topology.face_id(other)
                if oid is None or oid in members:
                    continue
                found = _cylinder_of(other)
                if found is None or not _same_cylinder(cylinder, found) or other.Orientation() != first.Orientation():
                    continue
                _, _, w0, w1 = BRepTools.UVBounds_s(other)
                if abs(w0 - v0) < 1e-5 and abs(w1 - v1) < 1e-5:
                    members.append(oid)
                    queue.append(oid)
            explorer.Next()
    return sorted(members) if sweep >= FULL else []


def split_centre(topology, face_id: int):
    """(position, axis, length) of the centre record of a face that is one part of a wall split into several faces (every
    part gets the same record, so a press on any part finds the hole); None for any other face."""
    face = topology.face(face_id)
    cylinder = _cylinder_of(face)
    if cylinder is None:
        return None
    u0, u1, v0, v1 = BRepTools.UVBounds_s(face)
    if u1 - u0 >= FULL:
        return None
    chain = wall_chain(topology, face_id)
    if len(chain) < 2:
        return None
    axis = cylinder.Axis()
    point = axis.Location().Translated(gp_Vec(axis.Direction()).Multiplied((v0 + v1) / 2))
    d = axis.Direction()
    return [point.X(), point.Y(), point.Z()], [d.X(), d.Y(), d.Z()], v1 - v0

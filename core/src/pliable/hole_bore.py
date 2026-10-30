"""Which face of a round hole is its bore: the wall a thread is cut into."""

from OCP.BRepAdaptor import BRepAdaptor_Surface
from OCP.BRepTools import BRepTools
from OCP.GeomAbs import GeomAbs_Cylinder

from .holes import FULL_TURN, find_hole
from .ops import OperationError


def bore_wall(topology, face_id: int) -> int | None:
    """The whole round wall of the bore (the narrowest part) of the hole that `face_id` belongs to, or None when the face is not part
    of a round hole or the bore has no whole wall (a split wall). A counterbore wall, a shoulder or a cone all lead to the bore, which is
    where a thread goes."""
    try:
        info = find_hole(topology, face_id=face_id, reach=False)
    except OperationError:
        return None
    for i in info.faces:
        face = topology.face(i)
        surface = BRepAdaptor_Surface(face)
        if surface.GetType() != GeomAbs_Cylinder or abs(surface.Cylinder().Radius() - info.diameter / 2) > 1e-6:
            continue
        u0, u1, _, _ = BRepTools.UVBounds_s(face)
        if u1 - u0 >= FULL_TURN:
            return i
    return None

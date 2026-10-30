"""What a selection means to the Hole Editor card: a place for a new hole, one hole, several holes, or something that is not a hole."""

from OCP.BRepAdaptor import BRepAdaptor_Surface
from OCP.BRepTools import BRepTools
from OCP.GeomAbs import GeomAbs_Cylinder

from .holes import FULL_TURN, find_hole
from .ops import OperationError, planar_normal
from .shared.hole_groups import Hole


def _hole_faces(topology, face_id: int | None, edge_id: int | None) -> tuple[int, ...] | None:
    """The faces of the hole that a face or rim edge belongs to, or None when it is not part of a round hole."""
    try:
        return tuple(sorted(find_hole(topology, face_id=face_id, edge_id=edge_id, reach=False).faces))
    except OperationError:
        return None


def _is_boss_wall(topology, face_id: int) -> bool:
    try:
        return BRepAdaptor_Surface(topology.face(face_id)).GetType() == GeomAbs_Cylinder and Hole.of(topology, face_id).boss
    except OperationError:
        return False


def _whole_wall(topology, faces: tuple[int, ...]) -> int | None:
    """A face of the hole that is one whole round wall (what Thread and Fill take), or None when the wall is split."""
    for i in faces:
        face = topology.face(i)
        if BRepAdaptor_Surface(face).GetType() == GeomAbs_Cylinder:
            u0, u1, _, _ = BRepTools.UVBounds_s(face)
            if u1 - u0 >= FULL_TURN:
                return i
    return None


def classify(topology, selection) -> dict:
    """{"kind": ...} where kind is "new" (one flat face: a place for a new hole), "hole" (one hole, picked by any of its faces, its rim or
    its center dot), "holes" (several holes, each picked by its round wall), "boss" (boss walls only) or "none" (empty, mixed or anything else).
    A single hole also reports "wall", a whole round wall of it (or null), because some helpers only take a wall."""
    picks = [(i, None) for i in selection.faces] + [(None, e) for e in selection.edges]
    if not picks:
        return {"kind": "none"}
    found = [_hole_faces(topology, f, e) for f, e in picks]
    if all(h is not None for h in found):
        distinct = set(found)
        if len(distinct) == 1:
            return {"kind": "hole", "wall": _whole_wall(topology, found[0])}
        walls_only = not selection.edges and all(BRepAdaptor_Surface(topology.face(i)).GetType() == GeomAbs_Cylinder for i in selection.faces)
        return {"kind": "holes", "count": len(distinct)} if walls_only else {"kind": "none"}
    if selection.edges or any(h is not None for h in found):
        return {"kind": "none"}
    if len(picks) == 1 and planar_normal(topology.face(selection.faces[0])) is not None:
        return {"kind": "new"}
    if all(_is_boss_wall(topology, i) for i in selection.faces):
        return {"kind": "boss"}
    return {"kind": "none"}

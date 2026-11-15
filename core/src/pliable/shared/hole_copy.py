"""The whole cut of a hole, for the array tools: its bore with any counterbore, countersink and thread, as one solid to cut again elsewhere.

The cut is the empty space around the hole's axis: a cylinder just wider than the widest coaxial wall, over the walls' length, minus the model.
That space holds the bore, counterbore, countersink and thread groove exactly as they are, whatever made them.
"""

from OCP.gp import gp_Vec

from ..holes import TOL, _axis_of, _inward, _on_axis, _parallel, _segment
from ..ops import OperationError
from .solids import _combine, _cylinder

THREAD_REACH = 1.5  # mm beyond the widest wall that is searched for a thread groove (the standard depth is 0.54 of a pitch, 1.35 mm at most for the metric sizes)


def _coaxial_wall(face, axis) -> bool:
    """A hole wall (cylinder or cone, material toward the axis) on the same line; a groove's partly round end faces count too."""
    other = _axis_of(face)
    return other is not None and _parallel(other[0].Direction(), axis.Direction()) and _on_axis(other[0].Location(), axis) and _inward(face)


def hole_cutter(topology, face_id: int) -> tuple[object, set[int]] | None:
    """(the solid that is the hole this wall belongs to, the ids of its coaxial walls), or None when the face is not a round wall."""
    found = _axis_of(topology.face(face_id))
    if found is None:
        return None
    axis = found[0]
    segments = {}
    for i in range(topology.face_count):
        face = topology.face(i)
        if i == face_id or _coaxial_wall(face, axis):
            try:
                segments[i] = _segment(topology, i, face, axis)
            except OperationError:
                continue
    if face_id not in segments:
        return None
    # Keep the walls that join the picked one end to end along the axis (another hole on the same line stays out).
    lo, hi = segments[face_id].s0, segments[face_id].s1
    members, changed = {face_id}, True
    while changed:
        changed = False
        for i, seg in segments.items():
            if i not in members and seg.s0 <= hi + TOL * 10 and seg.s1 >= lo - TOL * 10:
                members.add(i)
                lo, hi = min(lo, seg.s0), max(hi, seg.s1)
                changed = True
    radius = max(max(segments[i].r0, segments[i].r1) for i in members) + THREAD_REACH
    margin = 0.01 * (hi - lo) + 1e-3
    direction = axis.Direction()
    start = axis.Location().Translated(gp_Vec(direction).Multiplied(lo - margin))
    ring = _cylinder(start, direction, radius, hi - lo + 2 * margin)
    return _combine(ring, topology.shape, fuse=False), members

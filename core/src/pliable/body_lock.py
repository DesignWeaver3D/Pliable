"""Locked bodies: the one check every tool run goes through (`Tool.execute`).

A locked body (`Body.locked`) is an immutable reference. It can be picked and read by a tool (a face that only gives a
plane or a direction, a target, a path), but no tool may change it. A selected face, edge, vertex or body row that
belongs to a locked body therefore refuses the run, unless the tool reads that kind of selection as a reference only.
Tools that act on every body when nothing is chosen skip the locked ones (see `shared/bodies.py`).
"""

from OCP.TopoDS import TopoDS_Shape

from .body_scope import _compound, _owning
from .bodies import box_of
from .ops import OperationError, solids_of
from .volume import volume_of

LOCKED_MESSAGE = "This body is locked"


def has_locked(topology) -> bool:
    return any(b.locked for b in topology.bodies.bodies)


def refuse_locked(tool, topology, selection) -> None:
    """Raise OperationError when the selection names a locked body that the tool would change."""
    if not has_locked(topology):
        return
    solids = solids_of(topology.shape)
    state = topology.bodies
    if len(solids) != len(state.bodies):
        return
    skipped = set(tool.reference_face_ids(topology, selection))
    kinds = {
        "faces": [i for i in selection.faces if i not in skipped],
        "edges": [] if tool.reference_edges else list(selection.edges),
        "vertices": list(selection.vertices),
        "bodies": list(selection.bodies),
    }
    for field, ids in kinds.items():
        for i in ids:
            owners = _owning(topology, type(selection)(**{field: [i]}), solids)  # one at a time: a loose face must not hide the others
            if owners and any(state.bodies[k].locked for k in owners):
                raise OperationError(LOCKED_MESSAGE)


def keep_locked(topology, result):
    """Put every locked body back in `result` exactly as it was. A tool may rebuild a body it did not touch (the final
    cleanup does); a body of the same size and volume is swapped for the original. A locked body that is gone or changed
    (an automatic merge or cut reached it) refuses the run instead."""
    if not has_locked(topology):
        return result
    old, state = solids_of(topology.shape), topology.bodies
    if len(old) != len(state.bodies):
        return result
    new = solids_of(result.shape)
    boxes = {}

    def box(shape):
        key = id(shape)
        if key not in boxes:
            boxes[key] = (box_of(shape), abs(volume_of(shape)))
        return boxes[key]

    used: set[int] = set()
    swaps: dict[int, TopoDS_Shape] = {}
    for i, body in enumerate(state.bodies):
        if not body.locked:
            continue
        found = next((j for j, s in enumerate(new) if j not in used and old[i].IsSame(s)), None)
        if found is None:
            want, volume = box(old[i])
            for j, s in enumerate(new):
                if j in used:
                    continue
                have, size = box(s)
                tol = max(max(want[3] - want[0], want[4] - want[1], want[5] - want[2]) * 1e-6, 1e-9)
                if all(abs(a - b) <= tol for a, b in zip(want, have)) and abs(volume - size) <= 1e-6 * max(volume, 1.0):
                    found = j
                    swaps[j] = old[i]
                    break
        if found is None:
            raise OperationError(LOCKED_MESSAGE)
        used.add(found)
    if swaps:
        result.shape = _compound([swaps.get(j, s) for j, s in enumerate(new)])
    return result

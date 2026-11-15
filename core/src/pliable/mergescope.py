"""Which bodies an operation changed, for the merge passes that would otherwise look at the whole model.

A whole-model merge that no longer changes anything leaves every body merged, so a later operation that touches one body only needs to merge that
body. The merge may be limited to the changed bodies when the model it started from is known to be merged (`Topology.merged`,
set when an operation's merge of the whole model changed nothing, see `merge_settled`) and the bodies share no faces, edges or vertices with each other
or with a shape outside the bodies (then a merge of one body cannot reach another). In any other case the answer is None,
which means the whole model, as before.
"""

from contextlib import contextmanager
from contextvars import ContextVar

from .bodydisplay import _own_extents, body_ranges
from .facemerge import merge_faces
from .mergememo import merge_remembering
from .ops import OpResult, solids_of
from .topology import Topology


def changed_solids(topology, indices) -> frozenset | None:
    """The positions of the solids of `topology.shape` an operation changed (`indices`), as the `changed` argument of
    `merge_faces`; None when the whole model has to be merged."""
    if not getattr(topology, "merged", False) or not indices:
        return None
    solids = solids_of(topology.shape)
    chosen = frozenset(indices)
    if len(chosen) >= len(solids) or not all(0 <= i < len(solids) for i in chosen):
        return None
    if body_ranges(topology, solids) is None:  # a face, edge or vertex held by two bodies, or by a shape outside the bodies
        return None
    return chosen


def merge_settled(before: Topology, merged_shape) -> bool:
    """Whether a merge of the whole model left `before` as it was, by the numbers of faces, edges and vertices: a model
    the merge no longer changes can be merged body by body (`changed_solids`). A merge can take several operations to
    settle: the same-surface step leaves edges that the kernel's merge removes in the next operation."""
    after = Topology(merged_shape, bodies=())
    return (after.face_count, after.edge_count, after.vertex_count) == (before.face_count, before.edge_count, before.vertex_count)


def changed_between(before, after) -> frozenset:
    """The positions of the bodies of `after` that are not the very body of `before`, wherever it lay: what an
    operation that left the other bodies alone changed. A boolean may list the bodies it kept in another order, and a
    cut may split a body or leave none of it, so the numbers of bodies may differ."""
    old, new = solids_of(before), solids_of(after)
    moved = [i for i, body in enumerate(new) if i >= len(old) or not old[i].IsSame(body)]
    if not moved:
        return frozenset()
    spare = [body for i, body in enumerate(old) if i >= len(new) or not body.IsSame(new[i])]  # a body found elsewhere in the list is the same body
    return frozenset(i for i in moved if not any(new[i].IsSame(body) for body in spare))


def settled_beside(shape, merged_shape, changed: frozenset) -> bool:
    """Whether a merge of the whole model left the bodies outside `changed` as they were, by their numbers of faces, edges and
    vertices: the bodies the operation did not touch are merged, so the next operation can merge its own bodies only
    (`changed_solids`). The changed bodies themselves are expected to change in the merge (a cut leaves faces to join)."""
    before, after = solids_of(shape), solids_of(merged_shape)
    if len(before) != len(after):
        return False
    return all(_own_extents(a) == _own_extents(b) for i, (a, b) in enumerate(zip(before, after)) if i not in changed)


def finish_scoped(topology, shape, cutters=()) -> OpResult:
    """`finish` (shared/solids.py) for an operation on the whole model that changed some of its bodies: when the model it
    started from is known to be merged (`changed_solids`) only the changed bodies are merged, and the result is the whole-model
    merge. Otherwise the whole model is merged, and the result says whether that merge left the model as it was, or at least
    the bodies the operation did not change (`merged`), so the next operation can be scoped."""
    moved = changed_between(topology.shape, shape)
    changed = changed_solids(topology, moved)
    if changed is None and moved:  # a model not known to be merged: the merge made of its other bodies earlier is reused (mergememo.py)
        result = merge_remembering(topology, shape, moved, lambda placed: merge_faces(OpResult(placed, [])))
    else:
        result = merge_faces(OpResult(shape, []), changed=changed)
    result.cutters = list(cutters)
    result.merged = changed is not None or merge_settled(Topology(shape, bodies=()), result.shape) or settled_beside(shape, result.shape, moved)
    return result


_start: ContextVar = ContextVar("merge_start", default=None)


@contextmanager
def merging_from(topology):
    """While a tool runs on the whole model `topology` (or the part of it the tool is narrowed to), `finish` (shared/solids.py) merges only the bodies the
    tool changed, as `finish_scoped` does, so no tool has to ask for it."""
    token = _start.set(topology)
    try:
        yield
    finally:
        _start.reset(token)


def merge_start():
    return _start.get()

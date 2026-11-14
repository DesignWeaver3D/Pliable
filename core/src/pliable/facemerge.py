"""The one face merge step every tool ends in: faces and edges that share a surface or curve become one.

The kernel's merge runs first, at `MERGE_ANGLE`. When it breaks the shape, only the edges are merged. Faces of one
surface that the kernel left split are then joined by `samesurface.py`. Tracked faces, edges and vertices are followed
through every stage, so a selection survives the merge.
"""

from OCP.BRepBuilderAPI import BRepBuilderAPI_Copy
from OCP.ShapeUpgrade import ShapeUpgrade_UnifySameDomain
from OCP.TopAbs import TopAbs_COMPOUND, TopAbs_SOLID
from OCP.TopoDS import TopoDS_Iterator

from .mergelimits import MERGE_ANGLE
from .ops import OperationError, OpResult, _follow
from .samesurface import _compound_of, _solid_list, merge_same_surface
from .validity import is_valid


def _unified(shape, tracked, edges, vertices, merge_faces: bool):
    """`shape` after the kernel's merge (edges only when `merge_faces` is False), with the tracked items followed;
    None when the result is not valid. The merge edits its input in place, so it works on a copy of the geometry-sharing shape."""
    copy = BRepBuilderAPI_Copy(shape, False, True)
    tracked_c, edges_c, vertices_c = _follow(copy, tracked), _follow(copy, edges), _follow(copy, vertices)
    unify = ShapeUpgrade_UnifySameDomain(copy.Shape(), True, merge_faces, merge_faces)
    unify.SetAngularTolerance(MERGE_ANGLE)
    unify.Build()
    merged = unify.Shape()
    if merged.IsNull() or not is_valid(merged):
        return None
    history = unify.History()
    return merged, _follow(history, tracked_c), _follow(history, edges_c), _follow(history, vertices_c)


def merge_faces(result: OpResult, same_surface: bool = True, changed: frozenset | None = None) -> OpResult:
    """`result` with its faces and edges merged, the tracked items followed through the merge.
    `changed` (positions of the solids the operation changed; None = any) limits the search for faces of one surface to
    those solids; the caller promises the other solids were merged already and share nothing with them (mergescope.py).
    `same_surface` False skips joining faces of one surface the kernel left split (a drag preview: it costs time)."""
    # UnifySameDomain modifies its input in place, even in "safe input" mode, and the result of an operation shares
    # sub-shapes with the document's shape: every attempt merges its own topology-only copy (geometry and triangulations are shared).
    # Merging faces can break a valid result (a shelled, rounded body fused to its mirror image); then only the edges are merged.
    found = _unified_in_parts(result, changed) if changed is not None else None
    if found is None:
        found = _kernel_merge(result)
    merged, tracked, edges, vertices = found
    if same_surface:
        again = merge_same_surface(merged, changed if changed is not None and _solid_count(merged) == _solid_count(result.shape) else None)  # faces of one surface the kernel left split (samesurface.py)
        if again is not None:
            merged, tracked, edges, vertices = again.shape, again.follow(tracked), again.follow(edges), again.follow(vertices)
    return OpResult(merged, tracked, edges, vertices, unified=True)


def _kernel_merge(result: OpResult):
    """The kernel's merge of `result` (see `merge_faces`): the merged shape and the tracked faces, edges and vertices followed."""
    plain = (result.shape, result.tracked_faces, result.tracked_edges, result.tracked_vertices)
    attempts = [(*plain, True), (*plain, False)]
    for shape, faces, edges, vertices, merge in attempts:
        found = _unified(shape, faces, edges, vertices, merge)
        if found is not None:
            return found
    # Merging can corrupt very detailed solids; the plain result is still valid.
    return _unified_none(result)


def _unified_in_parts(result: OpResult, changed: frozenset):
    """The kernel's merge of only the `changed` solids of `result`, put back in their places among the others as they are;
    None when that cannot be done exactly (tracked items to follow, a shape that is not a flat compound of solids, or a
    merge that changed the solid count), and the whole shape is merged then. The copy, the merge and the validity check
    of the others (merged already, see mergescope.py) are what this saves."""
    if result.tracked_faces or result.tracked_edges or result.tracked_vertices:
        return None
    solids = _solid_list(result.shape)
    if not all(0 <= i < len(solids) for i in changed) or not _flat(result.shape, len(solids)):
        return None
    order = sorted(changed)
    inner = _kernel_merge(OpResult(_compound_of([solids[i] for i in order]), []))[0]
    made = _solid_list(inner)
    if len(made) != len(order):
        return None
    for i, solid in zip(order, made):
        solids[i] = solid
    return _compound_of(solids), [], [], []


def _flat(shape, solid_count: int) -> bool:
    """Whether `shape` is a compound whose direct members are all solids."""
    if shape.ShapeType() != TopAbs_COMPOUND:
        return False
    members = TopoDS_Iterator(shape)
    seen = 0
    while members.More():
        if members.Value().ShapeType() != TopAbs_SOLID:
            return False
        seen += 1
        members.Next()
    return seen == solid_count


def _solid_count(shape) -> int:
    return len(_solid_list(shape))


def _unified_none(result: OpResult):
    copy = BRepBuilderAPI_Copy(result.shape, False, True)
    if copy.Shape().IsNull() or not is_valid(copy.Shape()):
        raise OperationError("Operation produced invalid geometry")
    return copy.Shape(), _follow(copy, result.tracked_faces), _follow(copy, result.tracked_edges), _follow(copy, result.tracked_vertices)

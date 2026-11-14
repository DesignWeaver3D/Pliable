"""The one face merge step every tool ends in: faces and edges that share a surface or curve become one.

The kernel's merge runs first, at `MERGE_ANGLE`. When it breaks the shape, only the edges are merged. Faces of one
surface that the kernel left split are then joined by `samesurface.py`. Tracked faces, edges and vertices are followed
through every stage, so a selection survives the merge.
"""

from OCP.BRepBuilderAPI import BRepBuilderAPI_Copy
from OCP.ShapeUpgrade import ShapeUpgrade_UnifySameDomain

from .mergelimits import MERGE_ANGLE
from .ops import OperationError, OpResult, _follow
from .samesurface import _solid_list, merge_same_surface
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
    plain = (result.shape, result.tracked_faces, result.tracked_edges, result.tracked_vertices)
    attempts = [(*plain, True), (*plain, False)]
    for shape, faces, edges, vertices, merge in attempts:
        found = _unified(shape, faces, edges, vertices, merge)
        if found is not None:
            break
    else:
        # Merging can corrupt very detailed solids; the plain result is still valid.
        found = _unified_none(result)
    merged, tracked, edges, vertices = found
    if same_surface:
        again = merge_same_surface(merged, changed if changed is not None and _solid_count(merged) == _solid_count(result.shape) else None)  # faces of one surface the kernel left split (samesurface.py)
        if again is not None:
            merged, tracked, edges, vertices = again.shape, again.follow(tracked), again.follow(edges), again.follow(vertices)
    return OpResult(merged, tracked, edges, vertices, unified=True)


def _solid_count(shape) -> int:
    return len(_solid_list(shape))


def _unified_none(result: OpResult):
    copy = BRepBuilderAPI_Copy(result.shape, False, True)
    if copy.Shape().IsNull() or not is_valid(copy.Shape()):
        raise OperationError("Operation produced invalid geometry")
    return copy.Shape(), _follow(copy, result.tracked_faces), _follow(copy, result.tracked_edges), _follow(copy, result.tracked_vertices)

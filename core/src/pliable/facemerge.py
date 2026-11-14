"""The one face merge step every tool ends in: faces and edges that share a surface or curve become one.

The kernel's merge runs first, at `MERGE_ANGLE`. When it breaks the shape, only the edges are merged. Faces of one
surface that the kernel left split are then joined by `samesurface.py`. Tracked faces, edges and vertices are followed
through every stage, so a selection survives the merge.
"""

from OCP.BRepBuilderAPI import BRepBuilderAPI_Copy
from OCP.ShapeUpgrade import ShapeUpgrade_UnifySameDomain

from .ops import MERGE_ANGLE, OperationError, OpResult, _follow
from .samesurface import merge_same_surface
from .validity import is_valid
from .wallframes import align_walls


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


def merge_faces(result: OpResult, same_surface: bool = True, walls: bool = False) -> OpResult:
    """`result` with its faces and edges merged, the tracked items followed through the merge.
    `same_surface` False skips joining faces of one surface the kernel left split (a drag preview: it costs time).
    `walls` describes cylinder walls alike first (wallframes.py); that attempt is kept only when its merged shape is valid."""
    # UnifySameDomain modifies its input in place, even in "safe input" mode, and the result of an operation shares
    # sub-shapes with the document's shape: every attempt merges its own topology-only copy (geometry and triangulations are shared).
    attempts = []
    try:
        aligned = None
        if walls:
            first = BRepBuilderAPI_Copy(result.shape, False, True)
            aligned = align_walls(first.Shape())
    except Exception:  # an optional improvement: the kernel refusing a wall must not fail the operation
        aligned = None
    if aligned is not None:
        shape, pairs = aligned
        tracked = _follow(first, result.tracked_faces)
        attempts.append((shape, [next((new for old, new in pairs if old.IsSame(face)), face) for face in tracked],
                         _follow(first, result.tracked_edges), _follow(first, result.tracked_vertices), True))
    # Merging faces can break a valid result (a shelled, rounded body fused to its mirror image); then only the edges are merged.
    plain = (result.shape, result.tracked_faces, result.tracked_edges, result.tracked_vertices)
    attempts.append((*plain, True))
    attempts.append((*plain, False))
    for shape, faces, edges, vertices, merge in attempts:
        found = _unified(shape, faces, edges, vertices, merge)
        if found is not None:
            break
    else:
        # Merging can corrupt very detailed solids; the plain result is still valid.
        found = _unified_none(result)
    merged, tracked, edges, vertices = found
    if same_surface:
        again = merge_same_surface(merged)  # faces of one surface the kernel left split (samesurface.py)
        if again is not None:
            merged, tracked, edges, vertices = again.shape, again.follow(tracked), again.follow(edges), again.follow(vertices)
    return OpResult(merged, tracked, edges, vertices, unified=True)


def _unified_none(result: OpResult):
    copy = BRepBuilderAPI_Copy(result.shape, False, True)
    if copy.Shape().IsNull() or not is_valid(copy.Shape()):
        raise OperationError("Operation produced invalid geometry")
    return copy.Shape(), _follow(copy, result.tracked_faces), _follow(copy, result.tracked_edges), _follow(copy, result.tracked_vertices)

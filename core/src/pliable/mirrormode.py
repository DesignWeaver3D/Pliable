"""Mirror modeling mode: a change made on one side of a chosen plane is repeated on the other side.

A change is the material an operation added (new minus old) and the material it removed (old minus new). The added
part is mirrored in the plane and fused in, the removed part is mirrored and cut out, so a model that was symmetric
stays symmetric. Whole-body moves are not mirrored (they have no added or removed material of their own to repeat)."""

from OCP.BRepBuilderAPI import BRepBuilderAPI_Transform
from OCP.gp import gp_Ax2, gp_Dir, gp_Pnt, gp_Trsf

from .ops import OperationError, OpResult, _boolean, _follow, _volume_of, solids_of, unify_result

MIN_VOLUME = 1e-6


def _mirrored(shape, plane: dict):
    trsf = gp_Trsf()
    trsf.SetMirror(gp_Ax2(gp_Pnt(*plane["origin"]), gp_Dir(*plane["normal"])))
    return BRepBuilderAPI_Transform(shape, trsf, True).Shape()


def _material(op) -> object | None:
    """The shape of a boolean result when it holds material, else None."""
    if op is None or not solids_of(op.Shape()) or _volume_of(op.Shape()) < MIN_VOLUME:
        return None
    return op.Shape()


def mirror_result(old, result: OpResult, plane: dict) -> OpResult:
    """`result` with its change to `old` repeated on the other side of `plane`."""
    new = result.shape
    if new.IsSame(old) or not solids_of(new):
        return result
    shape, tracked = new, list(result.tracked_faces)
    if not solids_of(old):
        return result  # nothing to compare with: a first body is mirrored by building the second half later
    added = _material(_boolean(new, old, False, glue=False))
    removed = _material(_boolean(old, new, False, glue=False))
    if added is not None:
        fuse = _boolean(shape, _mirrored(added, plane), True, glue=False)
        if fuse is None:
            raise OperationError("Mirror mode could not repeat this change on the other side; turn mirror mode off to do it")
        shape, tracked = fuse.Shape(), _follow(fuse, tracked)
    if removed is not None:
        cut = _boolean(shape, _mirrored(removed, plane), False, glue=False)
        if cut is None:
            raise OperationError("Mirror mode could not repeat this cut on the other side; turn mirror mode off to do it")
        shape, tracked = cut.Shape(), _follow(cut, tracked)
    if shape is new:
        return result
    return unify_result(OpResult(shape, tracked, list(result.tracked_edges), list(result.tracked_vertices)))

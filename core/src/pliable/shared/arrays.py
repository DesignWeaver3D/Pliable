"""Copy helpers shared by the array tools."""

from OCP.BRepBuilderAPI import BRepBuilderAPI_Transform
from OCP.TopoDS import TopoDS_Shape
from OCP.gp import gp_Trsf, gp_Vec

from ..ops import OperationError, OpResult, solids_of
from .solids import _combine, _compound, _faces_of, finish


MAX_ARRAY_COPIES = 200


def _array_copies(count: float) -> int:
    n = int(round(count))
    if n < 2 or n > MAX_ARRAY_COPIES:
        raise OperationError(f"The count must be between 2 and {MAX_ARRAY_COPIES}")
    return n


def _grid_counts(columns: float, rows: float) -> tuple[int, int]:
    """Whole column and row counts (each at least 1, the original included); the grid needs at least one copy and at most MAX_ARRAY_COPIES in all."""
    c, r = int(round(columns)), int(round(rows))
    if c < 1 or r < 1:
        raise OperationError("The count and the rows must each be at least 1")
    if c * r < 2 or c * r > MAX_ARRAY_COPIES:
        raise OperationError(f"The grid must hold between 2 and {MAX_ARRAY_COPIES} copies in all")
    return c, r


def _grid_transforms(columns: int, rows: int, step1: gp_Vec, step2: gp_Vec) -> list[gp_Trsf]:
    """The translations of every grid cell but the original (column i, row j moves by i * step1 + j * step2)."""
    transforms = []
    for j in range(rows):
        for i in range(columns):
            if i == 0 and j == 0:
                continue
            trsf = gp_Trsf()
            trsf.SetTranslation(step1.Multiplied(i).Added(step2.Multiplied(j)))
            transforms.append(trsf)
    return transforms


def _array_source(topology, selection) -> TopoDS_Shape:
    """What an array copies: the solids containing the selected faces, or the whole model with no faces selected."""
    if not selection.faces:
        return topology.shape
    chosen = []
    for i in selection.faces:
        face = topology.face(i)
        for solid in solids_of(topology.shape):
            if any(f.IsSame(face) for f in _faces_of(solid)) and not any(solid.IsSame(c) for c in chosen):
                chosen.append(solid)
    if not chosen:
        raise OperationError("The selected faces do not belong to a solid")
    return _compound(chosen)


def _feature_holes(topology, selection) -> list:
    """The holes and bosses the selection names when every selected face is the full round wall of one (then an array copies those features, not the body); else an empty list."""
    from .hole_groups import Hole

    if not selection.faces:
        return []
    try:
        return [Hole(topology.face(i)) for i in selection.faces]
    except OperationError:
        return []


def _fuse_feature_copies(topology, holes: list, transforms: list[gp_Trsf]) -> OpResult:
    """Cut or fuse a transformed copy of each hole or boss for every transform (one boolean per transform and kind, so copies that touch each other stay valid)."""
    result = topology.shape
    for trsf in transforms:
        for boss in (False, True):
            solids = [BRepBuilderAPI_Transform(h.solid(), trsf, True).Shape() for h in holes if h.boss == boss]
            if solids:
                result = _combine(result, _compound(solids), fuse=boss)
    return finish(result)


def _fuse_copies(topology, selection, transforms: list[gp_Trsf]) -> OpResult:
    holes = _feature_holes(topology, selection)
    if holes:
        return _fuse_feature_copies(topology, holes, transforms)
    source = _array_source(topology, selection)
    result = topology.shape
    for trsf in transforms:
        result = _combine(result, BRepBuilderAPI_Transform(source, trsf, True).Shape(), fuse=True)
    return finish(result)

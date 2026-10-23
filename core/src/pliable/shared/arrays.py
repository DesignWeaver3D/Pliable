"""Copy helpers shared by the array tools."""

from OCP.BRepBuilderAPI import BRepBuilderAPI_Transform
from OCP.TopoDS import TopoDS_Shape
from OCP.gp import gp_Trsf

from ..ops import OperationError, OpResult, solids_of
from .solids import _combine, _compound, _faces_of, finish


MAX_ARRAY_COPIES = 200


def _array_copies(count: float) -> int:
    n = int(round(count))
    if n < 2 or n > MAX_ARRAY_COPIES:
        raise OperationError(f"The count must be between 2 and {MAX_ARRAY_COPIES}")
    return n


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


def _fuse_copies(topology, selection, transforms: list[gp_Trsf]) -> OpResult:
    source = _array_source(topology, selection)
    result = topology.shape
    for trsf in transforms:
        result = _combine(result, BRepBuilderAPI_Transform(source, trsf, True).Shape(), fuse=True)
    return finish(result)

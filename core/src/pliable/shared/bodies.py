"""Helpers for tools that act on whole bodies: choosing solids, centres and pivots."""

from OCP.BRep import BRep_Builder
from OCP.BRepBndLib import BRepBndLib
from OCP.Bnd import Bnd_Box
from OCP.TopoDS import TopoDS_Compound, TopoDS_Shape
from OCP.gp import gp_Pnt

from ..ops import OperationError, solids_of
from .solids import _faces_of


def _body_bounds(topology, selection):
    """Corner points (min, max) of the solids a whole-body tool acts on (the whole model with nothing selected)."""
    from OCP.Bnd import Bnd_Box
    from OCP.BRepBndLib import BRepBndLib

    box = Bnd_Box()

    def note(shape):
        BRepBndLib.AddOptimal_s(shape, box, False, False)
        return shape

    _on_bodies(topology, selection, note)
    if box.IsVoid():
        return (0.0, 0.0, 0.0), (0.0, 0.0, 0.0)
    lo, hi = box.CornerMin(), box.CornerMax()
    return (lo.X(), lo.Y(), lo.Z()), (hi.X(), hi.Y(), hi.Z())


def _chosen_solids(topology, selection) -> list:
    """The solids a whole-body tool acts on: the selected bodies, else the ones containing the selected faces."""
    solids = solids_of(topology.shape)
    chosen = []
    for body_id in selection.bodies:
        index = topology.bodies.find(body_id)
        if index is None or index >= len(solids):
            raise OperationError("The selected body no longer exists")
        chosen.append(solids[index])
    for i in selection.faces:
        face = topology.face(i)
        for solid in solids:
            if any(f.IsSame(face) for f in _faces_of(solid)) and not any(solid.IsSame(c) for c in chosen):
                chosen.append(solid)
    return chosen


def _body_centre(shape) -> gp_Pnt:
    """The middle of a body's bounding box: the pivot of rotate and scale when whole bodies are selected."""
    box = Bnd_Box()
    BRepBndLib.AddOptimal_s(shape, box, False, False)
    lo, hi = box.CornerMin(), box.CornerMax()
    return gp_Pnt((lo.X() + hi.X()) / 2, (lo.Y() + hi.Y()) / 2, (lo.Z() + hi.Z()) / 2)


def _pivot_point(topology, selection) -> tuple[float, float, float]:
    """Where rotate and scale pivot for the handles: the middle of the selected bodies' box, else the origin."""
    if not selection.bodies:
        return (0.0, 0.0, 0.0)
    lo, hi = _body_bounds(topology, selection)
    return tuple((a + b) / 2 for a, b in zip(lo, hi))


def _on_bodies(topology, selection, change, pivot: bool = False, trsf=None, record: dict | None = None, centre_always: bool = False) -> TopoDS_Shape:
    """Apply `change` (shape -> shape) to the selected bodies, else to the solids that contain the selected faces; with
    no selection, to the whole model. With `pivot` and bodies selected, `change(shape, centre)` also gets each body's own centre.
    With `trsf` (centre -> gp_Trsf) and `record`, the transform applied to each solid is stored in `record` by solid index,
    so editable primitives can follow the move (see recipes.py)."""
    if not selection.faces and not selection.bodies:
        if record is not None and trsf is not None:
            for index in range(len(solids_of(topology.shape))):
                record[index] = trsf(None)
        return change(topology.shape)
    chosen = _chosen_solids(topology, selection)
    if not chosen:
        raise OperationError("The selected faces do not belong to a solid")
    compound, builder = TopoDS_Compound(), BRep_Builder()
    builder.MakeCompound(compound)
    for index, solid in enumerate(solids_of(topology.shape)):
        if not any(solid.IsSame(c) for c in chosen):
            builder.Add(compound, solid)
        else:
            centre = _body_centre(solid) if pivot and (selection.bodies or centre_always) else None
            if record is not None and trsf is not None:
                record[index] = trsf(centre)
            builder.Add(compound, change(solid, centre) if centre is not None else change(solid))
    return compound

"""Helpers for tools that act on whole bodies: choosing solids, centers and pivots."""

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


def _unlocked_solids(topology) -> list | None:
    """The solids no lock protects, or None when no body is locked (then a tool that acts on every body acts on the whole shape).
    Raises when every body is locked."""
    solids, state = solids_of(topology.shape), topology.bodies
    if len(solids) != len(state.bodies) or not any(b.locked for b in state.bodies):
        return None
    keep = [s for s, b in zip(solids, state.bodies) if not b.locked]
    if not keep:
        raise OperationError("This body is locked")
    return keep


def _unlocked_shape(topology) -> TopoDS_Shape:
    """The shape a tool that acts on every body works on: without the locked bodies."""
    keep = _unlocked_solids(topology)
    return topology.shape if keep is None else _compound_of(keep)


def _relock(topology, result):
    """`result` (made from `_unlocked_shape`) with the locked bodies put back unchanged, each at its place in the list."""
    state, solids = topology.bodies, solids_of(topology.shape)
    if len(solids) != len(state.bodies) or not any(b.locked for b in state.bodies):
        return result
    out = solids_of(result.shape)
    for i, body in enumerate(state.bodies):
        if body.locked:
            out.insert(min(i, len(out)), solids[i])
    result.shape = _compound_of(out)
    return result


def _compound_of(solids) -> TopoDS_Shape:
    compound, builder = TopoDS_Compound(), BRep_Builder()
    builder.MakeCompound(compound)
    for solid in solids:
        builder.Add(compound, solid)
    return compound


def _chosen_or_unlocked(topology, selection) -> list:
    """The solids chosen by bodies or faces; with neither chosen, the unlocked ones when a lock exists, else [] (every body)."""
    if selection.bodies or selection.faces:
        return _chosen_solids(topology, selection)
    return _unlocked_solids(topology) or []


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
    no selection, to the whole model. With `pivot` and bodies selected, `change(shape, center)` also gets each body's own center.
    With `trsf` (center -> gp_Trsf) and `record`, the transform applied to each solid is stored in `record` by solid index,
    so editable primitives can follow the move (see recipes.py)."""
    if not selection.faces and not selection.bodies:
        keep = _unlocked_solids(topology)
        if keep is not None:  # locked bodies stay as they are; the others move or change together as the whole model would
            changed = solids_of(change(_compound_of(keep)))
            made = iter(changed)
            out = []
            for index, (solid, body) in enumerate(zip(solids_of(topology.shape), topology.bodies.bodies)):
                if body.locked:
                    out.append(solid)
                    continue
                if record is not None and trsf is not None:
                    record[index] = trsf(None)
                out.append(next(made, solid))
            out.extend(made)
            return _compound_of(out)
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

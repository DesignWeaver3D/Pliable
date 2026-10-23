"""The Combine bodies tool."""

from OCP.BRep import BRep_Builder
from OCP.TopoDS import TopoDS_Compound

from ..ops import _contains, OperationError, solids_of
from ..shared.solids import _combine, _volume, finish
from ..tools import Accepts, Param, register, Tool


@register
class BodyBoolean(Tool):
    """Boolean between two solids of the model. Select a face of the first (target) solid, then a face of the second
    (tool) solid. `mode` 0 unites them, 1 subtracts the tool from the target, 2 keeps only the overlap.
    Other solids stay as they are."""

    id = "body_boolean"
    label = "Combine bodies"
    description = "Combines two solids: mode 0 unites them, 1 subtracts the second from the first, 2 keeps only the overlap. Select a face of the first solid, then a face of the second."
    accepts = Accepts(faces=(2, 2))
    params = [Param("mode", "number", 0)]

    def combines(self, topology, selection, values):
        solids = solids_of(topology.shape)
        return [i for i, solid in enumerate(solids) if any(_contains(solid, topology.face(f)) for f in selection.faces)]

    def applies(self, topology, selection):
        return len(solids_of(topology.shape)) >= 2

    def run(self, topology, selection, values, preview):
        mode = int(round(values["mode"]))
        if mode not in (0, 1, 2):
            raise OperationError("Mode must be 0 (unite), 1 (subtract) or 2 (intersect)")
        solids = solids_of(topology.shape)
        owners = []
        for face_id in selection.faces:
            face = topology.face(face_id)
            index = next((i for i, solid in enumerate(solids) if _contains(solid, face)), None)
            if index is None:
                raise OperationError("A selected face is not part of a closed solid")
            owners.append(index)
        if owners[0] == owners[1]:
            raise OperationError("Select one face on each of two different solids")
        target, tool = solids[owners[0]], solids[owners[1]]
        if mode == 2:
            from OCP.BRepAlgoAPI import BRepAlgoAPI_Common

            common = BRepAlgoAPI_Common(target, tool)
            common.Build()
            if not common.IsDone() or common.Shape().IsNull() or _volume(common.Shape()) < 1e-9:
                raise OperationError("The two solids do not overlap")
            merged = common.Shape()
        else:
            merged = _combine(target, tool, fuse=mode == 0)
            if _volume(merged) < 1e-9:
                raise OperationError("The result would be empty")
        compound, builder = TopoDS_Compound(), BRep_Builder()
        builder.MakeCompound(compound)
        builder.Add(compound, merged)
        for i, solid in enumerate(solids):
            if i not in owners:
                builder.Add(compound, solid)
        return finish(compound)

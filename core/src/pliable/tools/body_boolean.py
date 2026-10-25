"""The Boolean tool."""

from OCP.BRep import BRep_Builder
from OCP.TopoDS import TopoDS_Compound

from ..ops import OperationError, solids_of
from ..shared.bodies import _chosen_solids
from ..shared.solids import _combine, _volume, finish
from ..tools import Accepts, Param, register, Tool

MODES = ("Union", "Subtract", "Intersect")


@register
class BodyBoolean(Tool):
    """Boolean between solids of the model. Select two or more bodies, or faces of them (a body and faces of another body
    also work); the first selected is the target and the others are the tools. `mode` 0 (Union) unites them, 1 (Subtract)
    subtracts the tools from the target, 2 (Intersect) keeps only the overlap. Other solids stay as they are."""

    id = "body_boolean"
    label = "Boolean"
    description = "Combines solids: Union joins them, Subtract removes the later ones from the first, Intersect keeps only the overlap. Select two or more bodies, or faces of them; the first selected is the target."
    accepts = Accepts(faces=(0, None), bodies=(0, None), any_of=True)
    params = [Param("mode", "number", 0, options=MODES)]

    def combines(self, topology, selection, values):
        chosen = _chosen_solids(topology, selection)
        return [i for i, solid in enumerate(solids_of(topology.shape)) if any(solid.IsSame(c) for c in chosen)]

    def applies(self, topology, selection):
        return len(_chosen_solids(topology, selection)) >= 2

    def refusal(self, topology, selection):
        return "Select two or more bodies, or faces on two different bodies"

    def run(self, topology, selection, values, preview):
        mode = int(round(values["mode"]))
        if mode not in (0, 1, 2):
            raise OperationError("Mode must be Union, Subtract or Intersect")
        solids = solids_of(topology.shape)
        chosen = _chosen_solids(topology, selection)
        target, tools = chosen[0], chosen[1:]
        merged = target
        for tool in tools:
            if mode == 2:
                from OCP.BRepAlgoAPI import BRepAlgoAPI_Common

                common = BRepAlgoAPI_Common(merged, tool)
                common.Build()
                if not common.IsDone() or common.Shape().IsNull() or _volume(common.Shape()) < 1e-9:
                    raise OperationError("The solids do not overlap")
                merged = common.Shape()
            else:
                merged = _combine(merged, tool, fuse=mode == 0)
                if _volume(merged) < 1e-9:
                    raise OperationError("The result would be empty")
        compound, builder = TopoDS_Compound(), BRep_Builder()
        builder.MakeCompound(compound)
        builder.Add(compound, merged)
        for solid in solids:
            if not any(solid.IsSame(c) for c in chosen):
                builder.Add(compound, solid)
        return finish(compound)

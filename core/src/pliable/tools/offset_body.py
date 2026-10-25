"""The Offset body tool."""

from ..ops import MIN_DISTANCE, OperationError, OpResult
from ..shared.bodies import _on_bodies
from ..shared.solids import finish, TOL
from ..tools import Accepts, Param, register, Tool


@register
class OffsetBody(Tool):
    """Grow (positive) or shrink (negative) the selected solids (all when nothing is selected) by a uniform distance."""

    id = "offset_body"
    whole_model_needs_one_body = True
    keeps_body_order = True
    label = "Offset body"
    description = "Grows (positive) or shrinks (negative) a solid evenly in all directions. Select bodies, any face of the solid, or nothing for the whole model."
    accepts = Accepts(faces=(0, None), bodies=(0, None))
    params = [Param("distance", "length", 1)]

    def run(self, topology, selection, values, preview):
        from OCP.BRepOffsetAPI import BRepOffsetAPI_MakeOffsetShape

        distance = values["distance"]
        if abs(distance) < MIN_DISTANCE:
            return OpResult(topology.shape, [])

        def offset(shape):
            maker = BRepOffsetAPI_MakeOffsetShape()
            try:
                maker.PerformByJoin(shape, distance, TOL)
            except Exception as e:  # OCCT raises Standard_Failure when the offset collapses geometry
                raise OperationError(f"Could not offset by this distance: {e}") from None
            if not maker.IsDone() or maker.Shape().IsNull():
                raise OperationError("Could not offset by this distance")
            return maker.Shape()

        return finish(_on_bodies(topology, selection, offset))

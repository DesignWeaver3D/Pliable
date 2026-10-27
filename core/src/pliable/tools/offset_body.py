"""The Offset body tool."""

from ..ops import MIN_DISTANCE, OperationError, OpResult
from ..shared.bodies import _body_bounds, _on_bodies
from ..shared.solids import finish, TOL
from ..tools import Accepts, Handle, Param, register, Tool


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

    def handles(self, topology, selection, values):
        # One arrow on the +X side of the chosen solids: that side moves out by exactly the distance.
        lo, hi = _body_bounds(topology, selection)
        d = values["distance"]
        return [Handle("distance", "Offset distance", (hi[0] + d, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2), (1.0, 0.0, 0.0))]

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

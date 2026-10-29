"""The Scale body tool."""

import math

from OCP.BRepBuilderAPI import BRepBuilderAPI_Transform
from OCP.gp import gp_Pnt, gp_Trsf

from ..ops import OperationError
from ..shared.bodies import _body_bounds, _on_bodies, _pivot_point
from ..shared.solids import finish
from ..tools import Accepts, Handle, Param, register, Tool


@register
class ScaleBody(Tool):
    """Scale the selected solids (the whole model when nothing is selected) uniformly about the origin."""

    id = "scale_body"
    whole_model_needs_one_body = True
    keeps_body_order = True
    label = "Scale body"
    description = "Scales a whole solid evenly, about the origin or about the body's center when you select bodies from the list. Select bodies, any face of a solid, or nothing for the whole model; 2 doubles the size."
    accepts = Accepts(faces=(0, None), bodies=(0, None))
    params = [Param("factor", "number", 1)]

    starts_from = "selection"

    def handles(self, topology, selection, values):
        lo, hi = _body_bounds(topology, selection)
        pivot = _pivot_point(topology, selection)
        lo, hi = [tuple(c[k] - pivot[k] for k in range(3)) for c in (lo, hi)]
        corner = max((lo, hi), key=lambda c: math.sqrt(sum(x * x for x in c)))  # the corner farthest from the pivot
        reach = math.sqrt(sum(x * x for x in corner))
        if reach < 1e-6:
            return []
        # Moving the handle outward along the line from the pivot through that corner scales the body about the pivot.
        return [Handle("factor", "Scale", tuple(pivot[k] + corner[k] * values["factor"] for k in range(3)), tuple(corner), scale=1 / reach, min=1e-3, unit="x")]

    def run(self, topology, selection, values, preview):
        factor = values["factor"]
        if factor < 1e-3 or factor > 1e3:
            raise OperationError("The scale factor must be between 0.001 and 1000")

        def scaling(centre=None):
            about = gp_Trsf()
            about.SetScale(centre or gp_Pnt(0, 0, 0), factor)
            return about

        def scale(shape, centre=None):
            return BRepBuilderAPI_Transform(shape, scaling(centre), True).Shape()

        record: dict = {}
        result = finish(_on_bodies(topology, selection, scale, pivot=True, trsf=scaling, record=record))
        result.moved = record
        return result

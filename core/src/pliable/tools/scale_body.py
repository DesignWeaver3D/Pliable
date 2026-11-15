"""The Scale body tool."""

import math

from OCP.BRepBuilderAPI import BRepBuilderAPI_GTransform, BRepBuilderAPI_Transform
from OCP.gp import gp_GTrsf, gp_Mat, gp_Pnt, gp_Trsf, gp_XYZ

from ..mergescope import finish_scoped
from ..ops import OperationError
from ..shared.bodies import _body_bounds, _on_bodies, _pivot_point
from ..tools import Accepts, Handle, Param, register, Tool


SCALINGS = ("Uniform", "Non-uniform")  # Non-uniform: `factor` is the X factor, `factor_y` and `factor_z` the others
LIMITS = "The scale factor must be between 0.001 and 1000"


@register
class ScaleBody(Tool):
    """Scale the selected solids (the whole model when nothing is selected) about the origin, evenly or with a factor for each world axis."""

    id = "scale_body"
    whole_model_needs_one_body = True
    keeps_body_order = True
    label = "Scale body"
    description = "Scales a whole solid evenly, about the origin or about the body's center when you select bodies from the list; Non-uniform scaling gives X, Y and Z their own factors (in the world axes). Select bodies, any face of a solid, or nothing for the whole model; 2 doubles the size."
    accepts = Accepts(faces=(0, None), bodies=(0, None))
    params = [Param("factor", "number", 1), Param("scaling", "number", options=SCALINGS), Param("factor_y", "number", 1), Param("factor_z", "number", 1)]

    starts_from = "selection"

    def handles(self, topology, selection, values):
        if values["scaling"] >= 0.5:
            return []  # the handle scales evenly; the factors of a non-uniform scale are typed
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
        factors = (values["factor"], values["factor_y"], values["factor_z"]) if values["scaling"] >= 0.5 else (values["factor"],) * 3
        if any(f < 1e-3 or f > 1e3 for f in factors):
            raise OperationError(LIMITS)
        factor = factors[0]
        uneven = not (factors[0] == factors[1] == factors[2])

        def scaling(centre=None):
            about = gp_Trsf()
            about.SetScale(centre or gp_Pnt(0, 0, 0), factor)
            return about

        def scale(shape, centre=None):
            if uneven:
                return _scale_axes(shape, factors, centre or gp_Pnt(0, 0, 0))
            return BRepBuilderAPI_Transform(shape, scaling(centre), True).Shape()

        record: dict = {}
        result = finish_scoped(topology, _on_bodies(topology, selection, scale, pivot=True, trsf=None if uneven else scaling, record=record))
        result.moved = record
        return result


def _scale_axes(shape, factors, centre):
    """`shape` scaled by a factor along each world axis about `centre`. A cylinder becomes an elliptical one, so the surfaces are
    rebuilt as splines (`BRepBuilderAPI_GTransform`); the result must be a valid shape."""
    from OCP.BRepCheck import BRepCheck_Analyzer

    matrix = gp_Mat(factors[0], 0, 0, 0, factors[1], 0, 0, 0, factors[2])
    about = gp_GTrsf()
    about.SetVectorialPart(matrix)
    about.SetTranslationPart(gp_XYZ(*(c - f * c for c, f in zip((centre.X(), centre.Y(), centre.Z()), factors))))
    made = BRepBuilderAPI_GTransform(shape, about, True)
    if not made.IsDone() or not BRepCheck_Analyzer(made.Shape()).IsValid():
        raise OperationError("Scaling by different factors failed on this shape; the model is unchanged")
    return made.Shape()

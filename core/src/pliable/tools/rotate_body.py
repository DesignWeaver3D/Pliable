"""The Rotate body tool."""

import math

from OCP.BRepBuilderAPI import BRepBuilderAPI_Transform
from OCP.gp import gp_Ax1, gp_Dir, gp_Pnt, gp_Trsf

from ..ops import OperationError
from ..shared.bodies import _body_bounds, _on_bodies, _pivot_point
from ..shared.solids import finish
from ..tools import Accepts, Handle, Param, register, Tool


@register
class RotateBody(Tool):
    """Rotate the selected solids (the whole model when nothing is selected) about an axis through the origin (axis: 0 = X, 1 = Y, 2 = Z), or through each selected body's center when bodies are selected."""

    id = "rotate_body"
    hidden = True  # Move/Rotate does this; the id stays for old documents and requests
    whole_model_needs_one_body = True
    keeps_body_order = True
    label = "Rotate body"
    description = "Rotates a whole solid about the X, Y or Z axis (0 = X, 1 = Y, 2 = Z): through the origin, or through the body's center when you select bodies from the list. Select bodies, any face of a solid, or nothing for the whole model."
    accepts = Accepts(faces=(0, None), bodies=(0, None))
    params = [Param("axis", "number", 2), Param("angle", "angle", 90)]

    starts_from = "selection"

    def handles(self, topology, selection, values):
        lo, hi = _body_bounds(topology, selection)
        axis = int(round(values["axis"]))
        if axis not in (0, 1, 2):
            return []
        # The ring's radius reaches past the body; the handle sits on it at the current angle, its direction the tangent.
        pivot = _pivot_point(topology, selection)
        lo, hi = [tuple(c[k] - pivot[k] for k in range(3)) for c in (lo, hi)]
        radius = max(max(math.hypot(c[(axis + 1) % 3], c[(axis + 2) % 3]) for c in (lo, hi)) * 1.25, 10.0)
        u, v = (axis + 1) % 3, (axis + 2) % 3
        angle = math.radians(values["angle"])
        anchor, tangent = list(pivot), [0.0, 0.0, 0.0]
        anchor[u], anchor[v] = pivot[u] + radius * math.cos(angle), pivot[v] + radius * math.sin(angle)
        tangent[u], tangent[v] = -math.sin(angle), math.cos(angle)
        return [Handle("angle", "Angle", tuple(anchor), tuple(tangent), scale=math.degrees(1 / radius), unit="°")]

    def run(self, topology, selection, values, preview):
        axis = int(round(values["axis"]))
        if axis not in (0, 1, 2):
            raise OperationError("The axis must be 0 (X), 1 (Y) or 2 (Z)")
        direction = gp_Dir(*(1.0 if k == axis else 0.0 for k in range(3)))
        def rotation(centre=None):
            about = gp_Trsf()
            about.SetRotation(gp_Ax1(centre or gp_Pnt(0, 0, 0), direction), math.radians(values["angle"]))
            return about

        def rotate(shape, centre=None):
            return BRepBuilderAPI_Transform(shape, rotation(centre), True).Shape()

        record: dict = {}
        result = finish(_on_bodies(topology, selection, rotate, pivot=True, trsf=rotation, record=record))
        result.moved = record
        return result

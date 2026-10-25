"""The Circular array tool."""

import math

from OCP.gp import gp_Ax1, gp_Dir, gp_Pnt, gp_Trsf

from ..ops import OperationError
from ..shared.arrays import _array_copies, _fuse_copies
from ..tools import Accepts, Param, register, Tool


@register
class CircularArray(Tool):
    """Copies of the chosen body (the whole model when no face is selected) rotated about an axis through the origin (0 = X, 1 = Y, 2 = Z), fused with it.
    `angle` is the total sweep; 360 spreads the copies evenly all the way round."""

    id = "circular_array"
    whole_model_needs_one_body = True
    label = "Circular array"
    description = "Makes copies of a body (select any of its faces, or nothing for the whole model) around the X, Y or Z axis through the origin (0 = X, 1 = Y, 2 = Z) and fuses them. The count includes the original; 360 spreads them round a full circle."
    accepts = Accepts(faces=(0, None))
    params = [Param("count", "number", 4), Param("axis", "number", 2), Param("angle", "angle", 360)]

    def run(self, topology, selection, values, preview):
        count = _array_copies(values["count"])
        axis = int(round(values["axis"]))
        if axis not in (0, 1, 2):
            raise OperationError("The axis must be 0 (X), 1 (Y) or 2 (Z)")
        angle = values["angle"]
        if abs(angle) < 1e-6:
            raise OperationError("Give a non-zero angle")
        full = abs(abs(angle) - 360) < 1e-6
        step = angle / (count if full else count - 1)
        direction = gp_Dir(*(1.0 if k == axis else 0.0 for k in range(3)))
        transforms = []
        for k in range(1, count):
            trsf = gp_Trsf()
            trsf.SetRotation(gp_Ax1(gp_Pnt(0, 0, 0), direction), math.radians(step * k))
            transforms.append(trsf)
        return _fuse_copies(topology, selection, transforms)

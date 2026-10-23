"""The Linear array tool."""

from OCP.gp import gp_Trsf, gp_Vec

from ..ops import MIN_DISTANCE, OperationError
from ..shared.arrays import _array_copies, _fuse_copies
from ..tools import Accepts, Param, register, Tool


@register
class LinearArray(Tool):
    """Copies of the chosen body (the whole model when no face is selected) at equal steps (dx, dy, dz), fused with it. `count` includes the original."""

    id = "linear_array"
    whole_model_needs_one_body = True
    label = "Linear array"
    description = "Makes copies of a body in a straight line and fuses them. Select any face of the body, or nothing for the whole model; the count includes the original."
    accepts = Accepts(faces=(0, None))
    params = [Param("count", "number", 3), Param("dx", "length", 20), Param("dy", "length"), Param("dz", "length")]
    move_vector = ("dx", "dy", "dz")

    def run(self, topology, selection, values, preview):
        count = _array_copies(values["count"])
        step = gp_Vec(values["dx"], values["dy"], values["dz"])
        if step.Magnitude() < MIN_DISTANCE:
            raise OperationError("Give a non-zero step")
        transforms = []
        for k in range(1, count):
            trsf = gp_Trsf()
            trsf.SetTranslation(step.Multiplied(k))
            transforms.append(trsf)
        return _fuse_copies(topology, selection, transforms)

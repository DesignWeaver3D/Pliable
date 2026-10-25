"""The Pattern hole / boss tool."""

from OCP.gp import gp_Vec

from ..ops import MIN_DISTANCE, OperationError
from ..shared.hole_groups import _CylinderFaces, _holes
from ..shared.solids import finish
from ..tools import Accepts, Param, register


@register
class PatternHole(_CylinderFaces):
    """Copies of a hole at a fixed spacing (a linear pattern): `count` holes in total."""

    id = "pattern_hole"
    label = "Pattern hole / boss"
    description = "Makes copies of a hole or boss in a straight line. Select its round face, then set the total count and the step between copies along X, Y and Z."
    accepts = Accepts(faces=(1, 1))
    params = [Param("count", "number", 3), Param("dx", "length", 10), Param("dy", "length"), Param("dz", "length")]
    move_vector = ("dx", "dy", "dz")

    def run(self, topology, selection, values, preview):
        count = int(round(values["count"]))
        if not 1 <= count <= 200:
            raise OperationError("The count must be between 1 and 200")
        step = gp_Vec(values["dx"], values["dy"], values["dz"])
        if count > 1 and step.Magnitude() < MIN_DISTANCE:
            raise OperationError("Give a spacing for the pattern")
        (hole,) = _holes(topology, selection)
        shape = topology.shape
        for i in range(1, count):
            shape = hole.place(shape, offset=step.Multiplied(i))
        return finish(shape)

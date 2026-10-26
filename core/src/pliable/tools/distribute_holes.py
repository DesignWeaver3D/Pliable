"""The Distribute holes / bosses tool."""

from ..shared.hole_groups import _HoleGroup, _holes
from ..tools import Accepts, Param, register


@register
class DistributeHoles(_HoleGroup):
    """Space the selected holes evenly along an axis between the two outermost ones."""

    id = "distribute_holes"
    label = "Distribute holes / bosses"
    description = "Spaces holes or bosses evenly between the two outermost ones, along the chosen axis (0 = X, 1 = Y, 2 = Z). Select three or more round faces in a row: only the position along the chosen axis changes, so a grid of holes (the four of a bracket base) is spread unevenly; select one row at a time."
    accepts = Accepts(faces=(3, None))
    params = [Param("axis", "number", 0)]

    def run(self, topology, selection, values, preview):
        axis = self._axis(values)
        holes = _holes(topology, selection)
        centres = [self._centre(h, axis) for h in holes]
        order = sorted(range(len(holes)), key=lambda i: centres[i])
        first, last = centres[order[0]], centres[order[-1]]
        deltas = [0.0] * len(holes)
        for rank, i in enumerate(order):
            deltas[i] = first + (last - first) * rank / (len(holes) - 1) - centres[i]
        return self._shift(topology, holes, deltas, axis)

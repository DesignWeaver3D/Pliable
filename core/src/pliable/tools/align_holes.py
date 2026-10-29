"""The Align holes / bosses tool."""

from ..shared.hole_groups import _HoleGroup, _holes
from ..tools import Accepts, Param, register


@register
class AlignHoles(_HoleGroup):
    """Match the position of every selected hole to the first selected one along an axis (Figma-style align)."""

    id = "align_holes"
    label = "Align holes / bosses"
    description = "Lines up holes or bosses so their centers match the first one you selected, along the chosen axis (0 = X, 1 = Y, 2 = Z). Select two or more round faces."
    accepts = Accepts(faces=(2, None))
    params = [Param("axis", "number", 0)]

    def run(self, topology, selection, values, preview):
        axis = self._axis(values)
        holes = _holes(topology, selection)
        reference = self._centre(holes[0], axis)
        return self._shift(topology, holes, [reference - self._centre(h, axis) for h in holes], axis)

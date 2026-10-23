"""The Fill hole / remove boss tool."""

from ..shared.hole_groups import _CylinderFaces, _holes, apply_holes
from ..shared.solids import finish
from ..tools import Accepts, register


@register
class FillHole(_CylinderFaces):
    id = "fill_hole"
    label = "Fill hole / remove boss"
    description = "Fills a hole with material, or cuts a boss back flush. Select the round face of the hole or boss."
    related = ("equal_radius",)
    accepts = Accepts(faces=(1, None))

    def run(self, topology, selection, values, preview):
        return finish(apply_holes(topology.shape, _holes(topology, selection)))

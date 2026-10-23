"""The Split with plane tool."""

from ..shared.planes import _plane_handles, TILT
from ..tools import Accepts, get_tool, Param, register, Tool


@register
class SplitPlane(Tool):
    """Split the model into two solids along a plane; the same as Cut with plane keeping both sides."""

    id = "split_plane"
    label = "Split with plane"
    description = "Splits the model into two solids along a plane (axis 0, 1, 2 = X, Y, Z or 3 for the direction nx, ny, nz). Cut with plane does the same with its keep-both choice. Select bodies to cut only those; with nothing selected every body is cut."
    accepts = Accepts(faces=(0, None), bodies=(0, None))
    params = [Param("axis", "number", 2), Param("position", "length"), Param("nx", "number", 0), Param("ny", "number", 0), Param("nz", "number", 1), *TILT]
    hidden = True

    def handles(self, topology, selection, values):
        return _plane_handles(topology, selection, values)

    def run(self, topology, selection, values, preview):
        return get_tool("cut_plane").run(topology, selection, {**values, "remove_side": 0.0}, preview)

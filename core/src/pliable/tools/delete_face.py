"""The Defeature tool."""

from ..shared.solids import _defeature
from ..tools import Accepts, register, Tool


@register
class DeleteFace(Tool):
    """Remove faces and heal: the neighbours are extended until they meet."""

    id = "delete_face"
    label = "Defeature"
    description = "Removes a feature (a pocket, boss, hole, slot or round) by deleting its faces and extending the neighbouring faces to close the gap. Select one or more faces of the feature; if the faces cannot be closed over, it says why."
    accepts = Accepts(faces=(1, None))

    def run(self, topology, selection, values, preview):
        return _defeature(topology, selection, "defeature these faces")

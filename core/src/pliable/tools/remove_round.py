"""The Remove fillet/chamfer tool."""

from ..shared.solids import _defeature
from ..tools import Accepts, register, Tool


@register
class RemoveRound(Tool):
    """Remove fillets or chamfers by deleting their faces; the adjacent faces extend back to a sharp edge."""

    id = "remove_round"
    label = "Remove fillet/chamfer"
    description = "Takes away a rounded or beveled edge and restores the sharp corner. Select the rounded or beveled face."
    accepts = Accepts(faces=(1, None))

    def run(self, topology, selection, values, preview):
        return _defeature(topology, selection, "remove this fillet or chamfer")

"""The Refine bodies tool."""

from ..ops import OpResult, solids_of
from ..shared.bodies import _chosen_solids
from ..shared.solids import _compound, finish
from ..tools import Accepts, register, Tool


@register
class Unify(Tool):
    """Refine bodies: merge coplanar and co-cylindrical faces (and the edges between them), e.g. after importing a split-up STEP file.
    Only the selected bodies (or the bodies of the selected faces) are refined; with nothing selected every body is."""

    id = "unify"
    label = "Refine bodies"
    description = "Unify: merges neighboring faces that lie on the same surface, for example after opening a file made of many small faces. Select bodies (or any face of them) to refine only those, which is much faster on a model with many bodies; with nothing selected every body is refined."
    accepts = Accepts(faces=(0, None), bodies=(0, None))
    params = []

    def run(self, topology, selection, values, preview):
        chosen = _chosen_solids(topology, selection) if (selection.bodies or selection.faces) else []
        if not chosen:
            return finish(topology.shape)
        out = []
        for solid in solids_of(topology.shape):
            if any(solid.IsSame(c) for c in chosen):
                out.extend(solids_of(finish(_compound([solid])).shape))
            else:
                out.append(solid)
        return OpResult(_compound(out), [], unified=True)

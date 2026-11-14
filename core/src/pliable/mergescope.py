"""Which bodies an operation changed, for the merge passes that would otherwise look at the whole model.

Every whole-model merge leaves every body merged, so a later operation that touches one body only needs to merge that
body. The merge may be limited to the changed bodies when the model it started from is known to be merged (`Topology.merged`,
set when an operation ends in a merge of the whole model) and the bodies share no faces, edges or vertices with each other
or with a shape outside the bodies (then a merge of one body cannot reach another). In any other case the answer is None,
which means the whole model, as before.
"""

from .bodydisplay import body_ranges
from .ops import solids_of


def changed_solids(topology, indices) -> frozenset | None:
    """The positions of the solids of `topology.shape` an operation changed (`indices`), as the `changed` argument of
    `merge_faces`; None when the whole model has to be merged."""
    if not getattr(topology, "merged", False) or not indices:
        return None
    solids = solids_of(topology.shape)
    chosen = frozenset(indices)
    if len(chosen) >= len(solids) or not all(0 <= i < len(solids) for i in chosen):
        return None
    if body_ranges(topology, solids) is None:  # a face, edge or vertex held by two bodies, or by a shape outside the bodies
        return None
    return chosen

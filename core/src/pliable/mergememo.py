"""The merged form of the bodies a drag leaves alone, remembered between its previews and its commit.

A model that is not yet known to be merged (mergescope.py) is merged as a whole by every operation, seconds on a model of
many bodies, and a drag asks for that again for every preview and for the commit, although only the moved body differs
between them. When the bodies share nothing with each other, the merge of the whole is the merge of each body, so the
first whole merge is kept on the model the operation started from (`Topology.merge_memo`: per unmoved body, the solid that
went in and the solid that came out) and the next ones merge the moved bodies only and take the others from the memory.
Any change in the model, or a body that does not match what was kept, merges the whole model as before.
"""

from OCP.Bnd import Bnd_Box
from OCP.BRepBndLib import BRepBndLib

from .bodydisplay import body_ranges
from .ops import OpResult, solids_of
from .samesurface import _compound_of, _solid_list

BOX_TOLERANCE = 1e-4  # relative to the size of the model: an unmoved body comes out of the merge where it went in


def _box(shape) -> list[float]:
    box = Bnd_Box()
    BRepBndLib.Add_s(shape, box, False)  # from the geometry: a merged face has lost its triangulation, the old ones have it
    if box.IsVoid():
        return []
    low, high = box.CornerMin(), box.CornerMax()
    return [low.X(), low.Y(), low.Z(), high.X(), high.Y(), high.Z()]


def merge_remembering(topology, placed, moved, merge) -> OpResult:
    """`merge(placed)` (the whole-model merge of an operation's result), done from the memory of an earlier call on
    `topology` when there is one that fits. `moved` holds the positions of the solids the operation changed."""
    solids = solids_of(placed)
    count = len(solids)
    chosen = sorted(moved)
    if not chosen or len(chosen) >= count or chosen[0] < 0 or chosen[-1] >= count:
        return merge(placed)
    memo = getattr(topology, "merge_memo", None)
    if memo is not None:
        kept = {i: out for i, (inside, out) in memo.items() if i not in moved and i < count and solids[i].IsSame(inside)}
        if len(kept) == count - len(chosen):
            made = _solid_list(merge(_compound_of([solids[i] for i in chosen])).shape)
            if len(made) == len(chosen):
                parts = dict(zip(chosen, made))
                return OpResult(_compound_of([kept[i] if i in kept else parts[i] for i in range(count)]), [], unified=True)
    result = merge(placed)
    out = _solid_list(result.shape)
    if len(out) == count and body_ranges(topology, solids_of(topology.shape)) is not None:
        diagonal = max((abs(a - b) for a, b in zip(_box(placed)[3:], _box(placed)[:3])), default=1.0) or 1.0
        topology.merge_memo = {i: (solids[i], out[i]) for i in range(count) if i not in moved and _same_place(solids[i], out[i], diagonal * BOX_TOLERANCE)}
    return result


def _same_place(a, b, tolerance: float) -> bool:
    box_a, box_b = _box(a), _box(b)
    return bool(box_a) and len(box_a) == len(box_b) and all(abs(x - y) <= tolerance for x, y in zip(box_a, box_b))

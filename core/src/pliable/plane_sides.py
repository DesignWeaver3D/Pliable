"""Which body each side of a cutting plane would give, so the form can color the names of the sides like those bodies."""

from .ops import solids_of
from .shared.planes import _cut_target, _model_middle
from .tools import get_tool
from .tools.cut_plane import _cutting_plane


def side_bodies(document, topology, selection, params: dict, change: dict) -> list[int | None]:
    """The ids of the body on Side 1 (the direction's side) and on Side 2 in the keep-both result of the same cut, None for a
    side with no body. The ids are those a commit of that result gives. Empty when the cut cannot be made."""
    tool = get_tool("cut_plane")
    try:
        result = tool.execute(topology, selection, {**params, "remove_side": 0.0}, preview=True)
        both = document.preview(result.shape, tool.body_kind, tool.keeps_body_order, change=change)
        values = tool.bind({**params, "remove_side": 0.0})
        normal, position = _cutting_plane(_cut_target(topology, selection)[1], values)
    except Exception:
        return []
    out: list[int | None] = [None, None]
    for body, solid in zip(both.bodies.bodies, solids_of(result.shape)):
        middle = _model_middle(solid)
        side = 0 if sum(normal[k] * middle[k] for k in range(3)) > position else 1
        if out[side] is None:
            out[side] = body.id
    return out

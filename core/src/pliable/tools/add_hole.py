"""The Add hole tool."""

from ..shared.hole_groups import _HoleOnFace
from ..tools import register


@register
class AddHole(_HoleOnFace):
    """A round hole into a flat face, positioned from the face centre; depth 0 cuts all the way through."""

    id = "add_hole"
    label = "Add hole"
    description = "Drills a round hole into a flat face, placed from the face centre. Select one flat face; depth 0 = through."

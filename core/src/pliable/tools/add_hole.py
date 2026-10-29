"""The Add hole tool."""

from ..shared.hole_groups import _HoleOnFace
from ..tools import register


@register
class AddHole(_HoleOnFace):
    """A round hole into a flat face, positioned from the face center; depth 0 cuts all the way through."""

    id = "add_hole"
    label = "Add hole"
    description = "Drills a round hole into a flat face, placed from the face center. Select one flat face; depth 0 = through."

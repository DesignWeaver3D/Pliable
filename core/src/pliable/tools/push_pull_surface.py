"""The Emboss/Cut along surface tool."""

from ..ops import planar_normal, push_pull
from .base import Accepts, Param, register, Tool


@register
class PushPullSurface(Tool):
    """Push or pull curved faces along the surface normal: the patch of a cylinder, cone or similar surface made by
    a sketch on unrolled faces is embossed (positive) or cut (negative) at its true shape."""

    id = "push_pull_surface"
    label = "Emboss/Cut along surface"
    description = "Raises or cuts curved faces along their surface normal, for example a pattern drawn on unrolled faces. Select curved faces and type a distance; positive raises, negative cuts."
    accepts = Accepts(faces=(1, None))
    # Not a drag tool: curved faces have no single drag direction, so the distance comes from the form.
    params = [Param("distance", "length", default=1.0)]

    def applies(self, topology, selection):
        return all(planar_normal(topology.face(i)) is None for i in selection.faces)

    def run(self, topology, selection, values, preview):
        faces = [topology.face(i) for i in selection.faces]
        result = push_pull(topology.shape, faces if len(faces) > 1 else faces[0], values["distance"], preview=preview)
        result.tracked_faces = result.tracked_faces[:1]
        return result

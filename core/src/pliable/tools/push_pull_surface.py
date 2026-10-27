"""The Emboss/Cut along surface tool."""

import math

from OCP.BRepTools import BRepTools

from ..ops import OperationError, planar_normal, push_pull
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
        if any(_goes_all_the_way_round(f) for f in faces):
            raise OperationError(
                "This face goes all the way round, so raising or cutting it only changes its radius, which is what Push/Pull does. "
                "To emboss or cut a pattern, sketch it on the unrolled face (Sketch on geometry), pick the pattern's patch and use this tool on that"
            )
        result = push_pull(topology.shape, faces if len(faces) > 1 else faces[0], values["distance"], preview=preview)
        result.tracked_faces = result.tracked_faces[:1]
        return result


def _goes_all_the_way_round(face) -> bool:
    """True for a whole cylinder or cone wall (a full turn), which is not a pattern wrapped onto it."""
    from OCP.BRepAdaptor import BRepAdaptor_Surface
    from OCP.GeomAbs import GeomAbs_Cone, GeomAbs_Cylinder

    if BRepAdaptor_Surface(face).GetType() not in (GeomAbs_Cylinder, GeomAbs_Cone):
        return False
    u0, u1, _, _ = BRepTools.UVBounds_s(face)
    return u1 - u0 > 2 * math.pi - 1e-6

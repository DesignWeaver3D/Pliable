"""The Emboss/Cut along surface tool."""

import math

from OCP.BRepTools import BRepTools

from ..ops import OperationError, _faces_of, planar_normal, push_pull
from .base import Accepts, Param, register, Tool


@register
class PushPullSurface(Tool):
    """Push or pull curved faces along the surface normal: the patch of a cylinder, cone or similar surface made by
    a sketch on unrolled faces is embossed (positive) or cut (negative) at its true shape."""

    id = "push_pull_surface"
    label = "Emboss/Cut along surface"
    description = "Raises or cuts curved faces along their surface normal, for example a pattern drawn on unrolled faces. Select curved faces and type a distance; positive raises, negative cuts. On a whole round wall, also choose a sketch drawn on its unrolled face in the Sketch list to wrap its regions onto the wall."
    accepts = Accepts(faces=(1, None))
    rail_regions = True  # a whole sketch chosen in the Sketch list can be wrapped onto a whole round wall (see run)
    # Not a drag tool: curved faces have no single drag direction, so the distance comes from the form.
    params = [Param("distance", "length", default=1.0)]

    def applies(self, topology, selection):
        return all(planar_normal(topology.face(i)) is None for i in selection.faces)

    def run(self, topology, selection, values, preview):
        faces = [topology.face(i) for i in selection.faces]
        if any(_goes_all_the_way_round(f) for f in faces):
            if selection.rail_content is not None:
                return _wrapped_sketch(topology, selection, values, preview)
            raise OperationError(
                "This face goes all the way round, so raising or cutting it only changes its radius, which is what Push/Pull does. "
                "To emboss or cut a pattern, sketch it on the unrolled face (Sketch on geometry), then pick the pattern's patch, or keep the sketch and choose it in the Sketch list with the wall selected, and use this tool"
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


def _wrapped_sketch(topology, selection, values, preview):
    """Wrap every closed region of the chosen sketch (drawn on the unrolled wall) onto the selected walls, then raise or cut
    those patches along the surface normal."""
    from OCP.BRepGProp import BRepGProp
    from OCP.GProp import GProp_GProps
    from OCP.TopoDS import TopoDS

    from ..unwrap import UnwrapError, wrap_patches

    if values["distance"] == 0:
        raise OperationError("The distance must not be zero")
    try:
        shape, _, mapped = wrap_patches(topology.shape, topology, list(selection.faces), selection.rail_content)
    except UnwrapError as e:
        raise OperationError(f"{e}. Draw the sketch on the unrolled wall (Sketch on geometry) and choose it in the Sketch list") from None

    def signature(face):
        props = GProp_GProps()
        BRepGProp.SurfaceProperties_s(face, props)
        centre = props.CentreOfMass()
        return props.Mass(), (centre.X(), centre.Y(), centre.Z())

    wanted = [signature(f) for f in mapped]
    patches = []
    for face in _faces_of(shape):
        area, centre = signature(face)
        if any(abs(area - a) <= 1e-6 * max(a, 1.0) and all(abs(x - y) <= 1e-5 * max(abs(y), 1.0) for x, y in zip(centre, c)) for a, c in wanted):
            patches.append(TopoDS.Face(face))
    if not patches:
        raise OperationError("The sketch's regions could not be wrapped onto the wall")
    result = push_pull(shape, patches if len(patches) > 1 else patches[0], values["distance"], preview=preview)
    result.tracked_faces = result.tracked_faces[:1]
    return result

"""The Mirror tool."""

from OCP.BRepBuilderAPI import BRepBuilderAPI_Transform
from OCP.gp import gp_Ax2, gp_Trsf, gp_Vec

from ..shared.faces import _PlanarFace, _plane_axes
from ..shared.solids import _combine, finish
from ..tools import Accepts, Param, register


@register
class Mirror(_PlanarFace):
    """Mirror the whole model across the plane of the selected flat face and join the copy."""

    id = "mirror"
    label = "Mirror"
    description = "Mirrors the whole model across the plane of a flat face and joins the copy. Select one flat face; offset moves the mirror plane."
    accepts = Accepts(faces=(1, 1))
    params = [Param("offset", "length")]

    def run(self, topology, selection, values, preview):
        centre, normal, _, _ = _plane_axes(topology.face(selection.faces[0]))
        centre = centre.Translated(gp_Vec(normal).Multiplied(values["offset"]))
        transform = gp_Trsf()
        transform.SetMirror(gp_Ax2(centre, normal))
        mirrored = BRepBuilderAPI_Transform(topology.shape, transform, True).Shape()
        return finish(_combine(topology.shape, mirrored, fuse=True))

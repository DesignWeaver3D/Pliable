"""The Add boss tool."""

from OCP.gp import gp_Vec

from ..ops import MIN_DISTANCE, OperationError
from ..shared.faces import _PlanarFace, _plane_axes
from ..shared.solids import _combine, _cylinder, finish
from ..tools import Accepts, Param, register


@register
class AddBoss(_PlanarFace):
    """A round boss standing out of a flat face, positioned from the face centre."""

    id = "add_boss"
    label = "Add boss"
    description = "Adds a round post standing on a flat face, placed from the face centre. Select one flat face."
    accepts = Accepts(faces=(1, 1))
    params = [Param("diameter", "length", 10), Param("height", "length", 5), Param("offset_u", "length"), Param("offset_v", "length")]

    def run(self, topology, selection, values, preview):
        if values["diameter"] < MIN_DISTANCE or values["height"] < MIN_DISTANCE:
            raise OperationError("The diameter and height must be positive")
        centre, normal, u, v = _plane_axes(topology.face(selection.faces[0]))
        start = centre.Translated(gp_Vec(u).Multiplied(values["offset_u"])).Translated(gp_Vec(v).Multiplied(values["offset_v"]))
        # Start a little inside the solid so the boss fuses cleanly with the face.
        sunk = start.Translated(gp_Vec(normal).Multiplied(-1e-3))
        boss = _cylinder(sunk, normal, values["diameter"] / 2, values["height"] + 1e-3)
        return finish(_combine(topology.shape, boss, fuse=True))

"""The Add boss tool."""

from OCP.gp import gp_Vec

from ..ops import MIN_DISTANCE, OperationError
from ..shared.faces import _PlanarFace, _plane_axes
from ..shared.newhole_handles import diameter_handles, Frame, position_handles
from ..shared.solids import _combine, _cylinder, finish
from ..tools import Accepts, Handle, Param, register


@register
class AddBoss(_PlanarFace):
    """A round boss standing out of a flat face, positioned from the face center."""

    id = "add_boss"
    label = "Add boss"
    description = "Adds a round post standing on a flat face, placed from the face center. Select one flat face."
    accepts = Accepts(faces=(1, 1))
    params = [Param("diameter", "length", 10), Param("height", "length", 5), Param("offset_u", "length"), Param("offset_v", "length")]

    def handles(self, topology, selection, values):
        # Radius and diameter grips on the boss's foot, an arrow at its top for the height, and two move arrows at its middle along the face's axes.
        frame = Frame(topology.face(selection.faces[0]), values)
        height = values["height"]
        top = frame.at(-height)
        out = diameter_handles(frame, "diameter", "Boss", values["diameter"])
        out.append(Handle("height", "Boss height", top, frame.normal, min=MIN_DISTANCE, kind="resize", axis_from=frame.start))
        return out + position_handles(frame, -height)

    def run(self, topology, selection, values, preview):
        if values["diameter"] < MIN_DISTANCE or values["height"] < MIN_DISTANCE:
            raise OperationError("The diameter and height must be positive")
        centre, normal, u, v = _plane_axes(topology.face(selection.faces[0]))
        start = centre.Translated(gp_Vec(u).Multiplied(values["offset_u"])).Translated(gp_Vec(v).Multiplied(values["offset_v"]))
        # Start a little inside the solid so the boss fuses cleanly with the face.
        sunk = start.Translated(gp_Vec(normal).Multiplied(-1e-3))
        boss = _cylinder(sunk, normal, values["diameter"] / 2, values["height"] + 1e-3)
        return finish(_combine(topology.shape, boss, fuse=True))

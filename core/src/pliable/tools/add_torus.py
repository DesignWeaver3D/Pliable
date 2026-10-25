"""The Add torus tool."""

from OCP.BRepPrimAPI import BRepPrimAPI_MakeTorus
from OCP.gp import gp_Ax2, gp_Dir, gp_Pnt

from ..ops import MIN_DISTANCE, OperationError
from ..shared.primitives import _position_handles, _turned, _with_rotation, ROTATION
from ..shared.solids import _add_material, _new_body, finish, NEW_BODY
from ..tools import Accepts, Param, register, round_handles, Tool


@register
class AddTorus(Tool):
    """A torus lying on the XY plane, centred at (x, y, z). `major` is the ring's centre-line diameter."""

    id = "add_torus"
    body_kind = "Torus"
    label = "Add torus"
    description = "Adds a ring shape (donut) at the given position, from the ring radius and the tube radius. Nothing needs to be selected; new_body 1 keeps it separate, 0 joins it to the model."
    placement = ("x", "y", "z")
    accepts = Accepts()
    params = [Param("major", "length", 20), Param("minor", "length", 5), Param("x", "length"), Param("y", "length"), Param("z", "length"), *ROTATION, NEW_BODY]

    starts_from = "tool"

    def anchors(self, values):
        t = values["minor"] / 2
        return [("Centre", (0, 0, 0)), ("Bottom", (0, 0, -t)), ("Top", (0, 0, t))]

    def handles(self, topology, selection, values):
        x, y, z, major, minor = (values[k] for k in ("x", "y", "z", "major", "minor"))
        return _with_rotation([
            *round_handles("major", "Ring", (x, y, z), (1, 0, 0), (0, 1, 0), major, min=MIN_DISTANCE),
            *round_handles("minor", "Tube", (x - major / 2, y, z), (0, 0, 1), (1, 0, 0), minor, min=MIN_DISTANCE),
            *_position_handles(values, major),
        ], values, major)

    def make(self, values):
        if values["minor"] < MIN_DISTANCE or values["major"] <= values["minor"]:
            raise OperationError("The ring diameter must be larger than the tube diameter, and both positive")
        axes = gp_Ax2(gp_Pnt(values["x"], values["y"], values["z"]), gp_Dir(0, 0, 1))
        return _turned(BRepPrimAPI_MakeTorus(axes, values["major"] / 2, values["minor"] / 2).Shape(), values)

    def combines(self, topology, selection, values):
        return None if _new_body(values) else "all"

    def run(self, topology, selection, values, preview):
        return finish(_add_material(topology.shape, self.make(values), _new_body(values)))

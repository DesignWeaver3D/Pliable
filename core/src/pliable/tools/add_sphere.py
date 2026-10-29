"""The Add sphere tool."""

from OCP.BRepPrimAPI import BRepPrimAPI_MakeSphere
from OCP.gp import gp_Pnt

from ..ops import MIN_DISTANCE, OperationError
from ..shared.primitives import _position_handles, _turned, _with_rotation, ROTATION
from ..shared.solids import _add_material, _new_body, finish, NEW_BODY
from ..tools import Accepts, Param, register, round_handles, Tool


@register
class AddSphere(Tool):
    id = "add_sphere"
    body_kind = "Sphere"
    label = "Add sphere"
    description = "Adds a sphere at the given position. Nothing needs to be selected; new_body 1 keeps it separate, 0 joins it to the model."
    placement = ("x", "y", "z")
    accepts = Accepts()
    params = [Param("diameter", "length", 10), Param("x", "length"), Param("y", "length"), Param("z", "length"), *ROTATION, NEW_BODY]

    starts_from = "tool"

    def anchors(self, values):
        r = values["diameter"] / 2
        return [("Center", (0, 0, 0)), ("Bottom", (0, 0, -r)), ("Top", (0, 0, r))]

    def handles(self, topology, selection, values):
        x, y, z, d = (values[k] for k in ("x", "y", "z", "diameter"))
        return _with_rotation([
            *round_handles("diameter", "Sphere", (x, y, z), (1, 0, 0), (0, 1, 0), d, min=MIN_DISTANCE),
            *_position_handles(values, d),
        ], values, d)

    def make(self, values):
        if values["diameter"] < MIN_DISTANCE:
            raise OperationError("The diameter must be positive")
        return _turned(BRepPrimAPI_MakeSphere(gp_Pnt(values["x"], values["y"], values["z"]), values["diameter"] / 2).Shape(), values)

    def combines(self, topology, selection, values):
        return None if _new_body(values) else "all"

    def run(self, topology, selection, values, preview):
        return finish(_add_material(topology.shape, self.make(values), _new_body(values)))

"""The Add cylinder tool."""

from OCP.gp import gp_Dir, gp_Pnt

from ..ops import MIN_DISTANCE, OperationError
from ..shared.primitives import _position_handles, _turned, _with_rotation, ROTATION
from ..shared.solids import _add_material, _cylinder, _new_body, finish, NEW_BODY
from ..tools import Accepts, Handle, Param, register, round_handles, Tool


@register
class AddCylinder(Tool):
    """A cylinder standing on the XY plane at (x, y, z), joined to the model."""

    id = "add_cylinder"
    body_kind = "Cylinder"
    label = "Add cylinder"
    description = "Adds a cylinder standing on the XY plane at the given position. Nothing needs to be selected; new_body 1 keeps it separate, 0 joins it to the model."
    placement = ("x", "y", "z")
    accepts = Accepts()
    params = [Param("diameter", "length", 10), Param("height", "length", 10), Param("x", "length"), Param("y", "length"), Param("z", "length"), *ROTATION, NEW_BODY]

    starts_from = "tool"

    def anchors(self, values):
        h = values["height"]
        return [("Bottom center", (0, 0, 0)), ("Center", (0, 0, h / 2)), ("Top center", (0, 0, h))]

    def handles(self, topology, selection, values):
        x, y, z, d, h = (values[k] for k in ("x", "y", "z", "diameter", "height"))
        return _with_rotation([
            *round_handles("diameter", "Cylinder", (x, y, z + h / 2), (1, 0, 0), (0, 1, 0), d, min=MIN_DISTANCE),
            Handle("height", "Resize height (top end)", (x, y, z + h), (0, 0, 1), min=MIN_DISTANCE, kind="resize"),
            Handle("height", "Resize height (bottom end, moves the origin)", (x, y, z), (0, 0, -1), min=MIN_DISTANCE, kind="resize", links=(("z", -1.0),)),
            *_position_handles(values, max(d, h)),
        ], values, max(d, h))

    def make(self, values):
        if min(values["diameter"], values["height"]) < MIN_DISTANCE:
            raise OperationError("The cylinder sizes must be positive")
        return _turned(_cylinder(gp_Pnt(values["x"], values["y"], values["z"]), gp_Dir(0, 0, 1), values["diameter"] / 2, values["height"]), values)

    def combines(self, topology, selection, values):
        return None if _new_body(values) else "all"

    def run(self, topology, selection, values, preview):
        return finish(_add_material(topology.shape, self.make(values), _new_body(values)))

"""The Add cone tool."""

from OCP.BRepPrimAPI import BRepPrimAPI_MakeCone
from OCP.gp import gp_Ax2, gp_Dir, gp_Pnt

from ..ops import MIN_DISTANCE, OperationError
from ..shared.primitives import _position_handles, _turned, _with_rotation, ROTATION
from ..shared.solids import _add_material, _new_body, finish, NEW_BODY
from ..tools import Accepts, Handle, Param, register, round_handles, Tool


@register
class AddCone(Tool):
    """A cone (or truncated cone) standing on the XY plane at (x, y, z)."""

    id = "add_cone"
    body_kind = "Cone"
    label = "Add cone"
    description = "Adds a cone or truncated cone (set a top diameter of 0 for a point) at the given position. Nothing needs to be selected; new_body 1 keeps it separate, 0 joins it to the model."
    placement = ("x", "y", "z")
    accepts = Accepts()
    params = [
        Param("bottom_diameter", "length", 10),
        Param("top_diameter", "length"),
        Param("height", "length", 10),
        Param("x", "length"),
        Param("y", "length"),
        Param("z", "length"),
        *ROTATION, NEW_BODY,
    ]

    starts_from = "tool"

    def anchors(self, values):
        h = values["height"]
        return [("Bottom center", (0, 0, 0)), ("Center", (0, 0, h / 2)), ("Top center", (0, 0, h))]

    def handles(self, topology, selection, values):
        x, y, z, bd, td, h = (values[k] for k in ("x", "y", "z", "bottom_diameter", "top_diameter", "height"))
        nudge = max(bd, h) * 0.06  # keeps the top-diameter handles off the height handle when the top is a point
        return _with_rotation([
            *round_handles("bottom_diameter", "Bottom", (x, y, z), (1, 0, 0), (0, 1, 0), bd, min=0.0),
            *round_handles("top_diameter", "Top", (x, y, z + h), (0, 1, 0), (1, 0, 0), td, offset=nudge, min=0.0),
            Handle("height", "Resize height (top end)", (x, y, z + h), (0, 0, 1), min=MIN_DISTANCE, kind="resize"),
            Handle("height", "Resize height (bottom end, moves the origin)", (x, y, z), (0, 0, -1), min=MIN_DISTANCE, kind="resize", links=(("z", -1.0),)),
            *_position_handles(values, max(bd, h)),
        ], values, max(bd, h))

    def make(self, values):
        if values["bottom_diameter"] < 0 or values["top_diameter"] < 0 or values["bottom_diameter"] + values["top_diameter"] < MIN_DISTANCE or values["height"] < MIN_DISTANCE:
            raise OperationError("Give a positive height and at least one positive diameter")
        axes = gp_Ax2(gp_Pnt(values["x"], values["y"], values["z"]), gp_Dir(0, 0, 1))
        return _turned(BRepPrimAPI_MakeCone(axes, values["bottom_diameter"] / 2, values["top_diameter"] / 2, values["height"]).Shape(), values)

    def combines(self, topology, selection, values):
        return None if _new_body(values) else "all"

    def run(self, topology, selection, values, preview):
        return finish(_add_material(topology.shape, self.make(values), _new_body(values)))

"""The Add prism tool."""

import math

from OCP.BRepBuilderAPI import BRepBuilderAPI_MakeFace, BRepBuilderAPI_MakePolygon
from OCP.BRepPrimAPI import BRepPrimAPI_MakePrism
from OCP.gp import gp_Pnt, gp_Vec

from ..ops import MIN_DISTANCE, OperationError
from ..shared.primitives import _position_handles, _turned, _with_rotation, ROTATION
from ..shared.solids import _add_material, _new_body, finish, NEW_BODY
from ..tools import Accepts, Handle, Param, register, round_handles, Tool

MIN_SIDES = 3
MAX_SIDES = 64


def _sides(values) -> int:
    sides = int(round(values["sides"]))  # the grip drags through fractions; the count is the nearest whole number
    if not MIN_SIDES <= sides <= MAX_SIDES:
        raise OperationError(f"The number of sides must be from {MIN_SIDES} to {MAX_SIDES}")
    return sides


@register
class AddPrism(Tool):
    """A prism standing on the XY plane at (x, y, z): a regular polygon base (one corner on the +X side of the centre) extruded up. `diameter` is the circle through the corners."""

    id = "add_prism"
    body_kind = "Prism"
    label = "Add prism"
    description = (
        "Adds a prism: a regular polygon (6 sides by default, a hexagon) of the given corner-to-corner diameter, standing on the XY plane at the given position. "
        "Nothing needs to be selected; new_body 1 keeps it separate, 0 joins it to the model."
    )
    placement = ("x", "y", "z")
    accepts = Accepts()
    params = [Param("sides", "number", 6), Param("diameter", "length", 10), Param("height", "length", 10), Param("x", "length"), Param("y", "length"), Param("z", "length"), *ROTATION, NEW_BODY]

    starts_from = "tool"

    def anchors(self, values):
        h = values["height"]
        return [("Bottom centre", (0, 0, 0)), ("Centre", (0, 0, h / 2)), ("Top centre", (0, 0, h))]

    def handles(self, topology, selection, values):
        x, y, z, d, h = (values[k] for k in ("x", "y", "z", "diameter", "height"))
        return _with_rotation([
            *round_handles("diameter", "Prism", (x, y, z + h / 2), (1, 0, 0), (0, 1, 0), d, min=MIN_DISTANCE),
            # A grip at the top rim's first corner that slides along the rim's tangent: one more side for every 0.05 of the diameter, and it sits that far out per side.
            Handle("sides", "Number of sides", (x + d / 2, y + (values["sides"] - MIN_SIDES) * 0.05 * d, z + h), (0, 1, 0), scale=1 / (0.05 * d), min=MIN_SIDES, max=MAX_SIDES, unit="", kind="resize"),
            Handle("height", "Resize height (top end)", (x, y, z + h), (0, 0, 1), min=MIN_DISTANCE, kind="resize"),
            Handle("height", "Resize height (bottom end, moves the origin)", (x, y, z), (0, 0, -1), min=MIN_DISTANCE, kind="resize", links=(("z", -1.0),)),
            *_position_handles(values, max(d, h)),
        ], values, max(d, h))

    def make(self, values):
        sides = _sides(values)
        if min(values["diameter"], values["height"]) < MIN_DISTANCE:
            raise OperationError("The prism sizes must be positive")
        x, y, z, radius = values["x"], values["y"], values["z"], values["diameter"] / 2
        polygon = BRepBuilderAPI_MakePolygon()
        for i in range(sides):
            angle = 2 * math.pi * i / sides
            polygon.Add(gp_Pnt(x + radius * math.cos(angle), y + radius * math.sin(angle), z))
        polygon.Close()
        face = BRepBuilderAPI_MakeFace(polygon.Wire()).Face()
        return _turned(BRepPrimAPI_MakePrism(face, gp_Vec(0, 0, values["height"])).Shape(), values)

    def combines(self, topology, selection, values):
        return None if _new_body(values) else "all"

    def run(self, topology, selection, values, preview):
        return finish(_add_material(topology.shape, self.make(values), _new_body(values)))

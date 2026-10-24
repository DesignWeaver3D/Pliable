"""The Add prism tool."""

import math

from OCP.BRepBuilderAPI import BRepBuilderAPI_MakeFace, BRepBuilderAPI_MakePolygon, BRepBuilderAPI_Sewing
from OCP.ShapeFix import ShapeFix_Solid
from OCP.TopAbs import TopAbs_SHELL
from OCP.TopExp import TopExp_Explorer
from OCP.TopoDS import TopoDS
from OCP.gp import gp_Pnt

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


def _ring(sides: int, x: float, y: float, z: float, radius: float) -> list[gp_Pnt]:
    return [gp_Pnt(x + radius * math.cos(2 * math.pi * i / sides), y + radius * math.sin(2 * math.pi * i / sides), z) for i in range(sides)]


def _face(points: list[gp_Pnt]):
    polygon = BRepBuilderAPI_MakePolygon()
    for p in points:
        polygon.Add(p)
    polygon.Close()
    return BRepBuilderAPI_MakeFace(polygon.Wire()).Face()


def _frustum(sides: int, x: float, y: float, z: float, bottom: float, top: float, height: float):
    """A solid with a regular polygon base of circumradius `bottom` and top of circumradius `top` (a zero one is a point, the apex), built only
    from planar faces: the two polygons (a zero one is left out) and one flat side per edge, sewn into a shell."""
    low = _ring(sides, x, y, z, bottom) if bottom > MIN_DISTANCE else None
    high = _ring(sides, x, y, z + height, top) if top > MIN_DISTANCE else None
    apex_low, apex_high = gp_Pnt(x, y, z), gp_Pnt(x, y, z + height)
    faces = [_face(ring) for ring in (low, high) if ring is not None]
    for i in range(sides):
        j = (i + 1) % sides
        if low is not None and high is not None:
            corners = [low[i], low[j], high[j], high[i]]  # a trapezoid
        elif high is None:
            corners = [low[i], low[j], apex_high]  # a triangle up to the apex
        else:
            corners = [apex_low, high[j], high[i]]  # a triangle down to the apex
        faces.append(_face(corners))
    sewing = BRepBuilderAPI_Sewing(1e-7)
    for face in faces:
        sewing.Add(face)
    sewing.Perform()
    explorer = TopExp_Explorer(sewing.SewedShape(), TopAbs_SHELL)
    if not explorer.More():
        raise OperationError("Could not build the prism")
    solid = ShapeFix_Solid().SolidFromShell(TopoDS.Shell(explorer.Current()))  # also turns the shell the right way round
    if solid.IsNull():
        raise OperationError("Could not build the prism")
    return solid


@register
class AddPrism(Tool):
    """A prism standing on the XY plane at (x, y, z): a regular polygon base (one corner on the +X side of the centre) with a top of its own size above it. The diameters are the circles through the corners; a top of 0 is a pyramid."""

    id = "add_prism"
    body_kind = "Prism"
    label = "Add prism"
    description = (
        "Adds a prism: a regular polygon (6 sides by default, a hexagon) with a bottom and a top corner-to-corner diameter, standing on the XY plane at the given position. "
        "A top diameter of 0 makes a pyramid. Nothing needs to be selected; new_body 1 keeps it separate, 0 joins it to the model."
    )
    placement = ("x", "y", "z")
    accepts = Accepts()
    params = [
        Param("sides", "number", 6),
        Param("bottom_diameter", "length", 10),
        Param("top_diameter", "length", 10),
        Param("height", "length", 10),
        Param("x", "length"),
        Param("y", "length"),
        Param("z", "length"),
        *ROTATION, NEW_BODY,
    ]

    starts_from = "tool"

    def anchors(self, values):
        h = values["height"]
        return [("Bottom centre", (0, 0, 0)), ("Centre", (0, 0, h / 2)), ("Top centre", (0, 0, h))]

    def handles(self, topology, selection, values):
        x, y, z, bd, td, h = (values[k] for k in ("x", "y", "z", "bottom_diameter", "top_diameter", "height"))
        nudge = max(bd, h) * 0.06  # keeps the top-diameter handles off the height handle when the top is a point
        rim, rim_z = (td, z + h) if td > 0 else (bd, z)  # the sides grip rides the top rim, or the bottom rim of a pyramid
        step = 0.05 * max(rim, MIN_DISTANCE)
        return _with_rotation([
            *round_handles("bottom_diameter", "Bottom", (x, y, z), (1, 0, 0), (0, 1, 0), bd, min=0.0),
            *round_handles("top_diameter", "Top", (x, y, z + h), (0, 1, 0), (1, 0, 0), td, offset=nudge, min=0.0),
            # A grip at the rim's first corner that slides along the rim's tangent: one more side for every 0.05 of the diameter, and it sits that far out per side.
            Handle("sides", "Number of sides", (x + rim / 2, y + (values["sides"] - MIN_SIDES) * step, rim_z), (0, 1, 0), scale=1 / step, min=MIN_SIDES, max=MAX_SIDES, unit="", kind="resize"),
            Handle("height", "Resize height (top end)", (x, y, z + h), (0, 0, 1), min=MIN_DISTANCE, kind="resize"),
            Handle("height", "Resize height (bottom end, moves the origin)", (x, y, z), (0, 0, -1), min=MIN_DISTANCE, kind="resize", links=(("z", -1.0),)),
            *_position_handles(values, max(bd, td, h)),
        ], values, max(bd, td, h))

    def make(self, values):
        sides = _sides(values)
        bd, td, h = values["bottom_diameter"], values["top_diameter"], values["height"]
        if bd < 0 or td < 0 or bd + td < MIN_DISTANCE or h < MIN_DISTANCE:
            raise OperationError("Give a positive height and at least one positive diameter")
        return _turned(_frustum(sides, values["x"], values["y"], values["z"], bd / 2, td / 2, h), values)

    def combines(self, topology, selection, values):
        return None if _new_body(values) else "all"

    def run(self, topology, selection, values, preview):
        return finish(_add_material(topology.shape, self.make(values), _new_body(values)))

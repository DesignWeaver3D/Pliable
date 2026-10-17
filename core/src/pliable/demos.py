"""Built-in demo models, also used as benchmark fixtures."""

from functools import cache

from build123d import Axis, Box, Cylinder, Pos, fillet
from OCP.TopoDS import TopoDS_Shape


def block() -> TopoDS_Shape:
    return Box(40, 30, 20).wrapped


def bracket() -> TopoDS_Shape:
    base = fillet(Box(80, 50, 10).edges().filter_by(Axis.Z), 6)
    upright = Pos(-35, 0, 25) * Box(10, 50, 40)
    part = base + upright
    for x in (-10, 25):
        for y in (-14, 14):
            part -= Pos(x, y, 0) * Cylinder(4, 20)
    part -= Pos(-35, 0, 32) * (Cylinder(7, 20).rotate(Axis.Y, 90))
    return part.wrapped


def perforated_plate() -> TopoDS_Shape:
    """Stress case: a filleted plate with 400 through holes (~800 faces)."""
    plate = fillet(Box(210, 210, 8).edges().filter_by(Axis.Z), 10)
    holes = [Pos(-95 + 10 * i, -95 + 10 * j, 0) * Cylinder(3, 20) for i in range(20) for j in range(20)]
    return plate.cut(*holes).wrapped


DEMOS = {"block": block, "bracket": bracket, "perforated_plate": perforated_plate}


@cache
def load_demo(name: str) -> TopoDS_Shape:
    if name not in DEMOS:
        raise KeyError(f"unknown demo {name!r}")
    return DEMOS[name]()

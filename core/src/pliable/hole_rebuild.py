"""Rebuilding a hole in a model that has no history: the profile of the cut a hole description makes, the solid it
turns into about the hole's axis, and filling the old cut and cutting the hole again with changed values.

`holes.py` finds the hole (`find_hole`, `HoleInfo`); the hole tools edit one through `rebuild_hole` here.
"""

import math

from OCP.BRepBndLib import BRepBndLib
from OCP.BRepBuilderAPI import BRepBuilderAPI_MakeFace, BRepBuilderAPI_MakePolygon
from OCP.BRepPrimAPI import BRepPrimAPI_MakeRevol
from OCP.Bnd import Bnd_Box
from OCP.gp import gp_Ax1, gp_Pnt, gp_Vec

from .holes import HoleInfo



def hole_profile(info: HoleInfo, margin: float = 0.0, diameter: float | None = None, depth: float | None = None,
                 through: bool | None = None, stages: list[dict] | None = None, start: float = 0.0,
                 end_stages: list[dict] | None = None, behind: float = 0.0, beyond: float = 0.0) -> list[tuple[float, float]]:
    """The cross-section of a hole as (s, r) points from the axis at the opening round to the axis at the far end,
    `margin` longer than the opening (and, for a through hole, than the far end) so booleans cut cleanly.
    With a `margin`, a counterbore or countersink at the opening continues as a cylinder of its major diameter
    `behind` the opening plane (the body's extent above it), and one at the far end of a through hole continues to
    `beyond` (the body's extent along the axis from the opening), so a curved face does not leave part of it buried."""
    radius = (info.diameter if diameter is None else diameter) / 2
    is_through = info.through if through is None else through
    length = info.depth if depth is None else depth
    steps = info.stages if stages is None else stages
    far = info.end_stages if end_stages is None else end_stages
    if start > 0:
        steps = []  # a skin of material over the bore covers the opening, so no step is cut there
    points: list[tuple[float, float]] = []

    def add(s: float, r: float):
        if not points or abs(points[-1][0] - s) > 1e-9 or abs(points[-1][1] - r) > 1e-9:
            points.append((s, r))

    end = length + (margin if is_through else 0.0)
    # Walk from the opening: each stage is wider than the bore and ends at its own depth.
    top = None
    for st in steps:
        if st["type"] == "countersink":
            half = math.radians(st["angle"]) / 2
            r_top = st["diameter"] / 2
            height = (r_top - radius) / math.tan(half)
            if height > 0:
                top = ("cone", r_top, height, half)
                break
        if st["type"] == "counterbore":
            top = ("bore", st["diameter"] / 2, st["depth"], 0.0)
            break
    if top is None:
        top_s = start if start > 0 else -margin
        add(top_s, 0.0)
        add(top_s, radius)
    elif top[0] == "cone":
        _, r_top, height, half = top
        wide = r_top + margin * math.tan(half)
        up = max(margin, behind + margin) if margin > 0 else margin
        add(-up, 0.0)
        add(-up, wide)
        add(-margin, wide)
        add(height, radius)
    else:
        _, r_top, bore_depth, _ = top
        up = max(margin, behind + margin) if margin > 0 else margin
        add(-up, 0.0)
        add(-up, r_top)
        add(-margin, r_top)
        add(bore_depth, r_top)
        add(bore_depth, radius)
    if is_through and far:
        st = far[0]
        wide = st["diameter"] / 2
        if st["type"] == "countersink":
            half = math.radians(st["angle"]) / 2
            add(length - (wide - radius) / math.tan(half), radius)
            wide += margin * math.tan(half)
            add(end, wide)
        else:
            add(length - st["depth"], radius)
            add(length - st["depth"], wide)
            add(end, wide)
        if margin > 0 and beyond + margin > end:
            end = beyond + margin
            add(end, wide)
        add(end, 0.0)
        return points
    add(end, radius)
    if not is_through and info.bottom == "cone" and info.tip_angle > 0:
        add(end + radius / math.tan(math.radians(info.tip_angle) / 2), 0.0)
    else:
        add(end, 0.0)
    return points


def _revolved(info: HoleInfo, points: list[tuple[float, float]], offset: gp_Vec | None = None):
    """The solid made by turning a profile about the hole's axis."""
    d = gp_Vec(info.direction)
    seed = gp_Vec(0, 0, 1) if abs(d.Z()) < 0.9 else gp_Vec(1, 0, 0)
    x = d.Crossed(seed).Normalized()
    origin = info.entry if offset is None else info.entry.Translated(offset)
    polygon = BRepBuilderAPI_MakePolygon()
    for s, r in points:
        polygon.Add(origin.Translated(d.Multiplied(s)).Translated(x.Multiplied(r)))
    polygon.Close()
    face = BRepBuilderAPI_MakeFace(polygon.Wire()).Face()
    return BRepPrimAPI_MakeRevol(face, gp_Ax1(origin, info.direction), 2 * math.pi).Shape()


def hole_solid(info: HoleInfo, offset: gp_Vec | None = None, **changes):
    """The cut a hole makes exactly (to fill it), or with `changes` applied (`diameter`, `depth`, `through`, `stages`)."""
    return _revolved(info, hole_profile(info, 0.0, **changes), offset)


def _body_extent(shape, info: HoleInfo, offset: gp_Vec | None = None) -> tuple[float, float]:
    """How far the body reaches along the hole's axis behind the opening plane and beyond it (from the opening, in the
    direction the hole runs), from its bounding box; the moved hole's opening when `offset` is given."""
    box = Bnd_Box()
    BRepBndLib.Add_s(shape, box)
    if box.IsVoid():
        return 0.0, 0.0
    origin = info.entry if offset is None else info.entry.Translated(offset)
    d = gp_Vec(info.direction)
    lo, hi = box.CornerMin(), box.CornerMax()
    along = [gp_Vec(origin, gp_Pnt(x, y, z)).Dot(d) for x in (lo.X(), hi.X()) for y in (lo.Y(), hi.Y()) for z in (lo.Z(), hi.Z())]
    return max(0.0, -min(along)), max(0.0, max(along))


def rebuild_hole(shape, info: HoleInfo, offset: gp_Vec | None = None, **changes):
    """The model with this hole filled and cut again with changes (`diameter`, `depth`, `through`, `stages`, `start`) and moved
    by `offset`. Returns the new shape (not yet unified)."""
    from .shared.solids import _combine

    size = max(info.pass_length, info.depth, info.diameter)
    margin = 0.01 * size + 1e-3
    filled = _combine(shape, _revolved(info, hole_profile(info, 0.0)), fuse=True)
    behind, beyond = _body_extent(shape, info, offset)
    new = _revolved(info, hole_profile(info, margin, behind=behind, beyond=beyond, **changes), offset)
    return _combine(filled, new, fuse=False)

"""The Concentric array tool: copies of a body in rings round an axis, each ring a step further out."""

import math

from OCP.gp import gp_Pnt, gp_Trsf, gp_Vec

from ..ops import OperationError
from ..shared.arrayaxis import AXIS_CHOICES, array_axis
from ..shared.arrays import MAX_ARRAY_COPIES, _fuse_copies
from ..shared.bodies import _body_bounds
from ..tools import Accepts, Handle, Param, register, Tool


def _radial(topology, selection, axis):
    """The body's center, the point of the axis nearest it and the unit direction from that point out to the center (a sideways direction when the body is centered on the axis)."""
    lo, hi = _body_bounds(topology, selection)
    centre = gp_Pnt(*((a + b) / 2 for a, b in zip(lo, hi)))
    direction, origin = axis.Direction(), axis.Location()
    along = gp_Vec(origin, centre).Dot(gp_Vec(direction))
    foot = origin.Translated(gp_Vec(direction).Multiplied(along))
    out = gp_Vec(foot, centre)
    if out.Magnitude() < 1e-6:
        out = gp_Vec(direction).Crossed(gp_Vec(0, 0, 1) if abs(direction.Z()) < 0.9 else gp_Vec(1, 0, 0))
    out.Normalize()
    return centre, foot, out


def _ring_counts(values) -> list[int]:
    """The number of positions on each ring (the source's own ring first, the source included)."""
    rings = int(round(values["rings"]))
    count = int(round(values["count"]))
    grow = int(round(values["grow"]))
    if rings < 1:
        raise OperationError("There must be at least one ring")
    if count < 1 or grow < 0:
        raise OperationError("The count must be at least 1 and the extra per ring cannot be negative")
    counts = [count + k * grow for k in range(rings)]
    if sum(counts) - 1 > MAX_ARRAY_COPIES:
        raise OperationError(f"That makes more than {MAX_ARRAY_COPIES} copies")
    return counts


@register
class ConcentricArray(Tool):
    """Copies of the chosen body (the whole model when no face is selected) in concentric rings about an axis, fused with it: the source's own ring first, then `rings - 1` rings, each `spacing` further out along the line from the axis to the source."""

    id = "concentric_array"
    whole_model_needs_one_body = True
    label = "Concentric array"
    description = (
        "Makes copies of a body (select any of its faces, or nothing for the whole model) in rings round the X, Y or Z axis through the origin, or round a picked edge, and fuses them. "
        "The first ring passes through the original; each further ring is the radial spacing further out. Count is the positions on the first ring and Extra per ring adds that many to each ring after it. "
        "Use the mouse wheel over the numbers on the model for the count, rings and extra, and drag the arrow for the spacing."
    )
    accepts = Accepts(faces=(0, None))
    params = [
        Param("count", "number", 6),
        Param("rings", "number", 2),
        Param("spacing", "length", 20),
        Param("grow", "number", 0),
        Param("axis", "number", 2, options=AXIS_CHOICES),
        Param("axis_edge", "number", -1),
    ]
    pick_edge = ("axis_edge", "axis")

    def handles(self, topology, selection, values):
        try:
            axis = array_axis(topology, values)
            counts = _ring_counts(values)
        except OperationError:
            return []
        centre, _, out = _radial(topology, selection, axis)

        def at(ring):
            p = centre.Translated(out.Multiplied(values["spacing"] * ring))
            return (p.X(), p.Y(), p.Z())

        rings = len(counts)
        up = (0.0, 0.0, 1.0)
        return [
            Handle("spacing", "Ring spacing", at(1), (out.X(), out.Y(), out.Z()), min=0.0),
            Handle("count", "Count", at(0), up, min=1, max=MAX_ARRAY_COPIES, unit="", badge=True),
            Handle("rings", "Rings", at(rings - 1), up, min=1, max=MAX_ARRAY_COPIES, unit="", badge=True),
            Handle("grow", "Extra per ring", at(min(1, rings - 1)), up, min=0, max=MAX_ARRAY_COPIES, unit="", badge=True),
        ]

    def run(self, topology, selection, values, preview):
        counts = _ring_counts(values)
        axis = array_axis(topology, values)
        spacing = values["spacing"]
        if len(counts) > 1 and spacing < 1e-6:
            raise OperationError("Give a positive ring spacing")
        _, _, out = _radial(topology, selection, axis)
        transforms = []
        for ring, n in enumerate(counts):
            for j in range(n):
                if ring == 0 and j == 0:
                    continue  # the source itself
                trsf = gp_Trsf()
                trsf.SetRotation(axis, 2 * math.pi * j / n)
                if ring:
                    move = gp_Trsf()
                    move.SetTranslation(out.Multiplied(spacing * ring))
                    trsf.Multiply(move)  # the ring's step out first, then the turn
                transforms.append(trsf)
        return _fuse_copies(topology, selection, transforms)

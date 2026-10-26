"""The Circular array tool."""

import math

from OCP.gp import gp_Pnt, gp_Trsf, gp_Vec

from ..ops import OperationError
from ..shared.arrayaxis import AXIS_CHOICES, array_axis
from ..shared.arrays import _array_copies, _fuse_copies
from ..shared.bodies import _body_bounds
from ..tools import Accepts, Handle, Param, register, Tool


@register
class CircularArray(Tool):
    """Copies of the chosen body (the whole model when no face is selected) rotated about an axis, fused with it: the X, Y or Z axis through the origin
    (0 = X, 1 = Y, 2 = Z) or, with `axis` 3, the axis of the straight or circular edge `axis_edge` (picked in the view).
    `angle` is the total sweep; 360 spreads the copies evenly all the way round."""

    id = "circular_array"
    whole_model_needs_one_body = True
    label = "Circular array"
    description = "Makes copies of a body (select any of its faces, or nothing for the whole model; select only the round walls of holes or bosses to copy just those features) around the X, Y or Z axis through the origin, or around a picked edge (Pick axis edge), and fuses them. The count includes the original; 360 spreads them round a full circle. Drag the arc grip for the angle and the arrow grip for the count."
    accepts = Accepts(faces=(0, None))
    params = [Param("count", "number", 4), Param("axis", "number", 2, options=AXIS_CHOICES), Param("angle", "angle", 360), Param("axis_edge", "number", -1)]
    pick_edge = ("axis_edge", "axis")  # the form's Pick axis edge button fills the edge id and chooses "Picked edge"

    def _step(self, values) -> float:
        count = max(int(round(values["count"])), 2)
        full = abs(abs(values["angle"]) - 360) < 1e-6
        return values["angle"] / (count if full else count - 1)

    def handles(self, topology, selection, values):
        try:
            axis = array_axis(topology, values)
        except OperationError:
            return []
        lo, hi = _body_bounds(topology, selection)
        centre = gp_Pnt(*((a + b) / 2 for a, b in zip(lo, hi)))
        direction, origin = axis.Direction(), axis.Location()
        along = gp_Vec(origin, centre).Dot(gp_Vec(direction))
        foot = origin.Translated(gp_Vec(direction).Multiplied(along))  # the point of the axis nearest the body's centre
        radius = foot.Distance(centre)
        if radius < 1e-6:  # the body is centred on the axis: ride on a ring of the body's own size
            radius = max(math.dist(lo, hi) / 2, 1.0)
            side = gp_Vec(direction).Crossed(gp_Vec(0, 0, 1) if abs(direction.Z()) < 0.9 else gp_Vec(1, 0, 0))
            side.Normalize()
            centre = foot.Translated(side.Multiplied(radius))

        def at(degrees):
            """The point of the ring `degrees` round from the body's centre, and the tangent there."""
            turn = gp_Trsf()
            turn.SetRotation(axis, math.radians(degrees))
            p = centre.Transformed(turn)
            tangent = gp_Vec(direction).Crossed(gp_Vec(foot, p))
            tangent.Normalize()
            return (p.X(), p.Y(), p.Z()), (tangent.X(), tangent.Y(), tangent.Z())

        ring = (foot.X(), foot.Y(), foot.Z(), radius)
        angle_point, angle_tangent = at(values["angle"])
        out = [Handle("angle", "Array angle", angle_point, angle_tangent, scale=math.degrees(1 / radius), unit="°", axis=(direction.X(), direction.Y(), direction.Z()), ring=ring)]
        # The count grip sits on the first copy: dragging it along the arc by one step adds a copy.
        step = self._step(values)
        arc = abs(math.radians(step)) * radius
        if arc > 1e-6:
            point, tangent = at(step)
            sign = 1.0 if step > 0 else -1.0
            out.append(Handle("count", "Copies", point, tuple(sign * c for c in tangent), scale=1 / arc, min=2, unit=""))
        return out

    def run(self, topology, selection, values, preview):
        count = _array_copies(values["count"])
        axis = array_axis(topology, values)
        angle = values["angle"]
        if abs(angle) < 1e-6:
            raise OperationError("Give a non-zero angle")
        step = self._step(values)
        transforms = []
        for k in range(1, count):
            trsf = gp_Trsf()
            trsf.SetRotation(axis, math.radians(step * k))
            transforms.append(trsf)
        return _fuse_copies(topology, selection, transforms)

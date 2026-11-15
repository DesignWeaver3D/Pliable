"""The Hole to slot tool: a plain round hole stretched along a direction into a slot of the same width and depth."""

from OCP.BRepPrimAPI import BRepPrimAPI_MakeBox
from OCP.gp import gp_Ax2, gp_Dir, gp_Vec

from ..ops import MIN_DISTANCE, OperationError, OpResult
from ..shared.hole_edit import _HoleTool
from ..shared.solids import _combine, _cylinder, finish
from ..tools import Param, register


@register
class HoleToSlot(_HoleTool):
    """Stretch a plain round hole into a slot: the hole's own position stays one end, the other end is the hole moved by the direction
    (dx, dy, dz) projected across the hole's axis. The slot keeps the hole's diameter and depth (through stays through)."""

    id = "hole_to_slot"
    label = "Hole to slot"
    description = (
        "Stretches a plain round hole into a slot of the same width and depth. Select a face of the hole, then give the direction and length "
        "as a move (X, Y, Z); only the part across the hole's axis counts. Holes with a counterbore, countersink or thread are refused."
    )
    move_vector = ("dx", "dy", "dz")
    params = [Param("dx", "length"), Param("dy", "length"), Param("dz", "length")]

    def run(self, topology, selection, values, preview):
        info = self.hole(topology, selection)
        if info.stages or info.end_stages:
            raise OperationError("This hole has a counterbore or countersink; only a plain round hole can be stretched into a slot")
        axis = gp_Vec(info.direction)
        move = gp_Vec(values["dx"], values["dy"], values["dz"])
        if move.Magnitude() < MIN_DISTANCE:
            return OpResult(topology.shape, [])  # nothing to stretch to yet
        across = move.Subtracted(axis.Multiplied(move.Dot(axis)))
        length = across.Magnitude()
        if length < MIN_DISTANCE:
            raise OperationError("The direction runs along the hole; give a direction across it")
        along = gp_Dir(across)
        width = info.diameter
        margin = 0.01 * max(info.pass_length, info.depth, width) + 1e-3
        depth = info.depth + (margin if info.through else 0.0)
        start = info.entry.Translated(axis.Multiplied(-margin))
        axes = gp_Ax2(start, info.direction, along)  # local X along the slot, local Y = axis x X
        corner = start.Translated(gp_Vec(axes.YDirection()).Multiplied(-width / 2))
        shape = _combine(topology.shape, BRepPrimAPI_MakeBox(gp_Ax2(corner, info.direction, along), length, width, depth + margin).Shape(), fuse=False)
        end = info.entry.Translated(across)
        shape = _combine(shape, _cylinder(end.Translated(axis.Multiplied(-margin)), info.direction, width / 2, depth + margin), fuse=False)
        return finish(shape)

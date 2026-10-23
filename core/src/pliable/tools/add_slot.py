"""The Add slot tool."""

import math

from OCP.BRepPrimAPI import BRepPrimAPI_MakeBox
from OCP.gp import gp_Ax2, gp_Dir, gp_Vec

from ..ops import MIN_DISTANCE, OperationError
from ..shared.faces import _PlanarFace, _plane_axes
from ..shared.solids import _bounds_diagonal, _combine, _cylinder, finish
from ..tools import Accepts, Param, register


@register
class AddSlot(_PlanarFace):
    """A slot (rounded-end rectangle) cut into a flat face. `length` is end to end, `angle` turns it about the
    face normal from the face's first in-plane direction; depth 0 cuts all the way through."""

    id = "add_slot"
    label = "Add slot"
    description = "Cuts a slot with rounded ends into a flat face, placed from the face centre. Select one flat face; angle turns the slot."
    accepts = Accepts(faces=(1, 1))
    params = [
        Param("length", "length", 20),
        Param("width", "length", 6),
        Param("depth", "length"),
        Param("angle", "angle"),
        Param("offset_u", "length"),
        Param("offset_v", "length"),
    ]

    def run(self, topology, selection, values, preview):
        length, width = values["length"], values["width"]
        if width < MIN_DISTANCE or length < width:
            raise OperationError("The slot needs a positive width and a length at least as large")
        centre, normal, u, v = _plane_axes(topology.face(selection.faces[0]))
        centre = centre.Translated(gp_Vec(u).Multiplied(values["offset_u"])).Translated(gp_Vec(v).Multiplied(values["offset_v"]))
        angle = math.radians(values["angle"])
        along = gp_Vec(u).Multiplied(math.cos(angle)).Added(gp_Vec(v).Multiplied(math.sin(angle)))
        along_dir = gp_Dir(along)
        down = normal.Reversed()
        depth = values["depth"] if values["depth"] > MIN_DISTANCE else _bounds_diagonal(topology.shape)
        margin = 0.01 * depth + 1e-3
        lead = centre.Translated(gp_Vec(normal).Multiplied(margin))
        straight = length - width
        axes = gp_Ax2(lead, down, along_dir)  # local X along the slot, local Y = down x X
        side = gp_Vec(axes.YDirection())
        corner = lead.Translated(gp_Vec(along_dir).Multiplied(-straight / 2)).Translated(side.Multiplied(-width / 2))
        parts = [BRepPrimAPI_MakeBox(gp_Ax2(corner, down, along_dir), straight, width, depth + margin).Shape()] if straight > MIN_DISTANCE else []
        for sign in (-1, 1):
            end = lead.Translated(gp_Vec(along_dir).Multiplied(sign * straight / 2))
            parts.append(_cylinder(end, down, width / 2, depth + margin))
        shape = topology.shape
        for part in parts:
            shape = _combine(shape, part, fuse=False)
        return finish(shape)

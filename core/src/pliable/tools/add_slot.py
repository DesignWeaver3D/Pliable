"""The Add slot tool."""

import math

from OCP.BRepPrimAPI import BRepPrimAPI_MakeBox
from OCP.gp import gp_Ax2, gp_Dir, gp_Vec

from ..ops import MIN_DISTANCE, OperationError
from ..shared.faces import _PlanarFace, _plane_axes
from ..shared.solids import _bounds_diagonal, _combine, _cylinder, finish
from ..tools import Accepts, Handle, Param, register


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

    def handles(self, topology, selection, values):
        """A gizmo for every parameter: move arrows along the face's two directions (position), a grip at each end (length) and at one side (width), a grip down from the face
        (depth, 0 = through), and a turn arc about the face normal (angle)."""
        if len(selection.faces) != 1:
            return []
        centre, normal, u, v = _plane_axes(topology.face(selection.faces[0]))
        vec = lambda d: (d.X(), d.Y(), d.Z())
        at = lambda p, *terms: tuple(c + sum(k * d[i] for k, d in terms) for i, c in enumerate((p.X(), p.Y(), p.Z())))
        centre = centre.Translated(gp_Vec(u).Multiplied(values["offset_u"])).Translated(gp_Vec(v).Multiplied(values["offset_v"]))
        angle = math.radians(values["angle"])
        along = tuple(math.cos(angle) * a + math.sin(angle) * b for a, b in zip(vec(u), vec(v)))
        side = tuple(-math.sin(angle) * a + math.cos(angle) * b for a, b in zip(vec(u), vec(v)))
        length, width = values["length"], values["width"]
        back = tuple(-c for c in along)
        down = tuple(-c for c in vec(normal))
        depth = values["depth"]
        radius = length / 2 + max(width, 4.0)  # the turn arc rides outside the slot's ends, 45 degrees round from its length
        phase = angle + math.pi / 4
        radial = tuple(math.cos(phase) * a + math.sin(phase) * b for a, b in zip(vec(u), vec(v)))
        tangent = tuple(-math.sin(phase) * a + math.cos(phase) * b for a, b in zip(vec(u), vec(v)))
        return [
            Handle("offset_u", "Move along the face's first direction", at(centre), vec(u), kind="move"),
            Handle("offset_v", "Move along the face's second direction", at(centre), vec(v), kind="move"),
            Handle("length", "Slot length (+)", at(centre, (length / 2, along)), along, scale=2.0, min=max(width, MIN_DISTANCE), kind="resize"),
            Handle("length", "Slot length (-)", at(centre, (length / 2, back)), back, scale=2.0, min=max(width, MIN_DISTANCE), kind="resize"),
            Handle("width", "Slot width", at(centre, (width / 2, side)), side, scale=2.0, min=MIN_DISTANCE, max=length, kind="resize"),
            Handle("depth", "Slot depth (0 = through)", at(centre, (depth, down)), down, min=0.0, kind="resize"),
            Handle("angle", "Slot angle", at(centre, (radius, radial)), tangent, scale=math.degrees(1 / radius), unit="°", axis=vec(normal), ring=(*at(centre), radius), arc=True),
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
        def cutting_parts(origin, corner, lead_in):
            parts = [BRepPrimAPI_MakeBox(gp_Ax2(corner, down, along_dir), straight, width, depth + lead_in).Shape()] if straight > MIN_DISTANCE else []
            for sign in (-1, 1):
                end = origin.Translated(gp_Vec(along_dir).Multiplied(sign * straight / 2))
                parts.append(_cylinder(end, down, width / 2, depth + lead_in))
            return parts

        shape = topology.shape
        for part in cutting_parts(lead, corner, margin):
            shape = _combine(shape, part, fuse=False)
        ghost = []  # the preview's ghost: the same parts starting on the face; a through slot has no real end to draw
        if preview and values["depth"] > MIN_DISTANCE:
            ghost = cutting_parts(centre, corner.Translated(gp_Vec(normal).Multiplied(-margin)), 0.0)
        return finish(shape, ghost)

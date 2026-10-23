"""Placement, rotation and handles shared by the primitive-creating tools."""

import math

from OCP.BRepBuilderAPI import BRepBuilderAPI_Transform
from OCP.gp import gp_Ax1, gp_Dir, gp_Pnt, gp_Trsf, gp_Vec

from ..tools import Handle, Param


def _position_handles(values, size: float) -> list[Handle]:
    """Three move arrows at a primitive's reference point, one per axis, each starting there and pointing the positive
    way along its axis (drawn in the axis colour), like an axis gizmo."""
    x, y, z = values["x"], values["y"], values["z"]
    return [
        Handle("x", "Move along X", (x, y, z), (1, 0, 0), kind="move"),
        Handle("y", "Move along Y", (x, y, z), (0, 1, 0), kind="move"),
        Handle("z", "Move along Z", (x, y, z), (0, 0, 1), kind="move"),
    ]


ROTATION = [Param("rx", "angle"), Param("ry", "angle"), Param("rz", "angle")]


def _primitive_turn(values) -> gp_Trsf | None:
    """The turn a primitive gets about its base point (x, y, z): rx about X, then ry about Y, then rz about Z. None when it is not turned."""
    angles = [values.get(n, 0.0) for n in ("rx", "ry", "rz")]
    if all(abs(a) < 1e-9 for a in angles):
        return None
    c = gp_Pnt(values["x"], values["y"], values["z"])
    total = gp_Trsf()
    for k in (2, 1, 0):  # Multiply puts the later factor first, so this applies X, then Y, then Z
        if abs(angles[k]) < 1e-9:
            continue
        turn = gp_Trsf()
        turn.SetRotation(gp_Ax1(c, gp_Dir(*(1.0 if i == k else 0.0 for i in range(3)))), math.radians(angles[k]))
        total.Multiply(turn)
    return total


def _turned(shape, values):
    turn = _primitive_turn(values)
    return shape if turn is None else BRepBuilderAPI_Transform(shape, turn, True).Shape()


def _with_rotation(handles: list[Handle], values, size: float) -> list[Handle]:
    """A primitive's handles turned with the primitive, plus one rotation ring per axis about its base point. A grip that
    also moves the base point (a low face) is left out while the primitive is turned, since its own axes are no longer X, Y and Z."""
    from dataclasses import replace

    turn = _primitive_turn(values)
    out = []
    for h in handles:
        if turn is not None and h.kind != "move":
            if h.links:
                continue
            h = replace(
                h,
                anchor=tuple(gp_Pnt(*h.anchor).Transformed(turn).Coord()),
                direction=tuple(gp_Vec(*h.direction).Transformed(turn).Coord()),
            )
        out.append(h)
    centre = (values["x"], values["y"], values["z"])
    radius = max(size * 0.9, 8.0)
    axes = ((1, 0, 0), (0, 1, 0), (0, 0, 1))
    for i, name in enumerate(("rx", "ry", "rz")):
        u, v = (i + 1) % 3, (i + 2) % 3
        theta = math.radians(45 + values.get(name, 0.0))
        anchor, tangent = list(centre), [0.0, 0.0, 0.0]
        anchor[u], anchor[v] = centre[u] + radius * math.cos(theta), centre[v] + radius * math.sin(theta)
        tangent[u], tangent[v] = -math.sin(theta), math.cos(theta)
        out.append(Handle(name, f"Rotate about {'XYZ'[i]}", tuple(anchor), tuple(tangent), scale=math.degrees(1 / radius), unit="°", axis=axes[i], ring=(*centre, radius)))
    return out

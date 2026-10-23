"""Cutting-plane parameters and handles shared by the plane tools."""

import math

from OCP.BRepBndLib import BRepBndLib
from OCP.Bnd import Bnd_Box
from OCP.gp import gp_Ax1, gp_Dir, gp_Pnt, gp_Vec

from ..ops import OperationError
from ..tools import Handle, Param
from .bodies import _chosen_solids
from .solids import _bounds_diagonal, _compound


def _plane_normal(values) -> tuple[float, float, float]:
    """The unit normal of a cutting plane: world axis 0, 1 or 2, or axis 3 for the direction (nx, ny, nz)."""
    axis = int(round(values["axis"]))
    if axis in (0, 1, 2):
        return tuple(1.0 if k == axis else 0.0 for k in range(3))
    if axis != 3:
        raise OperationError("axis must be 0, 1 or 2 (a world axis) or 3 (the direction nx, ny, nz)")
    n = [values.get("nx", 0.0), values.get("ny", 0.0), values.get("nz", 0.0)]
    length = math.sqrt(sum(c * c for c in n))
    if length < 1e-9:
        raise OperationError("Give a plane direction (nx, ny, nz) that is not zero")
    return tuple(c / length for c in n)


TILT = [Param("tilt_u", "angle"), Param("tilt_v", "angle")]


def _plane_frame(normal) -> tuple[tuple, tuple]:
    """Two unit axes square to `normal` that the plane is tilted about (the same two every time for the same normal)."""
    ref = (1.0, 0.0, 0.0) if abs(normal[2]) > 0.9 else (0.0, 0.0, 1.0)
    u = gp_Vec(*normal).Crossed(gp_Vec(*ref))
    u.Normalize()
    v = gp_Vec(*normal).Crossed(u)
    return (u.X(), u.Y(), u.Z()), (v.X(), v.Y(), v.Z())


def _tilted(vec, axis, degrees: float):
    v = gp_Vec(*vec)
    v.Rotate(gp_Ax1(gp_Pnt(0, 0, 0), gp_Dir(*axis)), math.radians(degrees))
    return (v.X(), v.Y(), v.Z())


def _model_middle(shape) -> tuple[float, float, float]:
    box = Bnd_Box()
    BRepBndLib.Add_s(shape, box)
    return tuple((box.CornerMin().Coord(k + 1) + box.CornerMax().Coord(k + 1)) / 2 for k in range(3))


def _cut_target(topology, selection):
    """The solids a plane cuts: the selected bodies (or the bodies of the selected faces), else every body. Returns (chosen solids or [], their shape)."""
    chosen = _chosen_solids(topology, selection) if (selection.bodies or selection.faces) else []
    return chosen, (_compound(chosen) if chosen else topology.shape)


def _plane_handles(topology, selection, values) -> list[Handle]:
    """An arrow that slides the plane along its untilted normal and a ring for each of the two tilts, centred where the plane
    is nearest the model's middle. A tilt grip sits where the plane's normal points after that turn alone."""
    base = _plane_normal(values)
    target = _cut_target(topology, selection)[1]
    mid = _model_middle(target)
    shift = values["position"] - sum(base[i] * mid[i] for i in range(3))
    centre = tuple(mid[k] + base[k] * shift for k in range(3))
    u, v = _plane_frame(base)
    radius = max(_bounds_diagonal(target) * 0.6, 8.0)
    out = [Handle("position", "Move the cutting plane", centre, base, kind="move")]
    for name, label, axis in (("tilt_u", "Tilt the plane about its first axis", u), ("tilt_v", "Tilt the plane about its second axis", v)):
        spot = _tilted(base, axis, 45 + values.get(name, 0.0))
        anchor = tuple(centre[k] + spot[k] * radius for k in range(3))
        tangent = gp_Vec(*axis).Crossed(gp_Vec(*spot))
        tangent.Normalize()
        out.append(Handle(name, label, anchor, (tangent.X(), tangent.Y(), tangent.Z()), scale=math.degrees(1 / radius), unit="°", axis=axis, ring=(*centre, radius)))
    return out

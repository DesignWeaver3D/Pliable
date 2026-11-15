"""The frame a stretch is typed and dragged in, its pivot, and the rigid move they give."""

import math

import numpy as np
from OCP.BRepAdaptor import BRepAdaptor_Curve
from OCP.GeomAbs import GeomAbs_Circle, GeomAbs_Line
from OCP.gp import gp_Ax1, gp_Dir, gp_Pnt, gp_Trsf, gp_Vec

from .field import Move

WORLD, PICKED, FREE = 0, 1, 2  # the frame choices, in the order the form lists them
FRAMES = ("World", "Picked face or edge", "Free")
PIVOTS = ("Selection center", "Picked point")
WORLD_AXES = np.eye(3)


def _turned(axes: np.ndarray, angles) -> np.ndarray:
    """The axes turned about world X, then Y, then Z by the angles (degrees)."""
    for k, angle in enumerate(angles):
        a, (i, j) = math.radians(angle), ((k + 1) % 3, (k + 2) % 3)
        turn = np.eye(3)
        turn[i, i], turn[i, j], turn[j, i], turn[j, j] = math.cos(a), -math.sin(a), math.sin(a), math.cos(a)
        axes = axes @ turn.T
    return axes


def _along(direction: np.ndarray) -> np.ndarray:
    """A frame whose Z runs along the direction; X is the world X (or Y) made square to it."""
    z = direction / np.linalg.norm(direction)
    seed = WORLD_AXES[0] if abs(z[0]) < 0.9 else WORLD_AXES[1]
    x = seed - (seed @ z) * z
    x /= np.linalg.norm(x)
    return np.array([x, np.cross(z, x), z])


def edge_direction(edge) -> np.ndarray | None:
    """The direction a picked edge gives a frame: a straight edge's line, a circular edge's axis."""
    curve = BRepAdaptor_Curve(edge)
    if curve.GetType() == GeomAbs_Line:
        d = curve.Line().Direction()
    elif curve.GetType() == GeomAbs_Circle:
        d = curve.Circle().Axis().Direction()
    else:
        return None
    return np.array([d.X(), d.Y(), d.Z()])


def frame_axes(values: dict, topology=None) -> np.ndarray:
    """The three unit axes (rows) of the frame the form's values choose."""
    choice = int(round(values.get("frame", 0)))
    if choice == PICKED:
        edge = int(round(values.get("frame_edge", -1)))
        direction = None
        if topology is not None and 0 <= edge < topology.edge_count:
            direction = edge_direction(topology.edge(edge))
        if direction is None:
            direction = np.array([values.get("fx", 0.0), values.get("fy", 0.0), values.get("fz", 0.0)])
        if np.linalg.norm(direction) > 1e-9:
            return _along(direction)
        return WORLD_AXES
    if choice == FREE:
        return _turned(WORLD_AXES, (values.get("fa", 0.0), values.get("fb", 0.0), values.get("fc", 0.0)))
    return WORLD_AXES


def pivot_point(values: dict, centre: np.ndarray) -> np.ndarray:
    if int(round(values.get("pivot", 0))) == 1:
        return np.array([values.get("px", 0.0), values.get("py", 0.0), values.get("pz", 0.0)])
    return centre


def rigid_move(values: dict, axes: np.ndarray, pivot: np.ndarray) -> Move:
    """The move the form's values ask for: a tilt about the frame's X, then Y, then Z through the pivot, then a shift along the frame's axes."""
    shift = values["dx"] * axes[0] + values["dy"] * axes[1] + values["dz"] * axes[2]
    total = gp_Trsf()
    total.SetTranslation(gp_Vec(*map(float, shift)))
    for k in (2, 1, 0):  # Multiply puts the later factor first, so this applies X, then Y, then Z
        angle = values.get(("rx", "ry", "rz")[k], 0.0)
        if abs(angle) < 1e-9:
            continue
        turn = gp_Trsf()
        turn.SetRotation(gp_Ax1(gp_Pnt(*map(float, pivot)), gp_Dir(*map(float, axes[k]))), math.radians(angle))
        total.Multiply(turn)
    return Move.from_trsf(total, pivot)

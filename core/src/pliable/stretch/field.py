"""The deformation of space a stretch applies: the rigid move of the protected part, faded out along the band."""

import math
from dataclasses import dataclass

import numpy as np
from OCP.gp import gp_Ax1, gp_Dir, gp_Pnt, gp_Trsf, gp_Vec

from .falloff import Falloff

NO_TURN = 1e-12  # radians: below this the move is a plain shift


@dataclass
class Move:
    """A rigid move: a turn of `angle` (radians) about the line through `pivot` along `axis`, then a shift."""

    shift: np.ndarray
    pivot: np.ndarray = None
    axis: np.ndarray = None
    angle: float = 0.0

    @property
    def turns(self) -> bool:
        return abs(self.angle) > NO_TURN

    @property
    def still(self) -> bool:
        return not self.turns and float(np.linalg.norm(self.shift)) < 1e-9

    def apply(self, points: np.ndarray, share=1.0) -> np.ndarray:
        """The points after `share` of the move (one share for all, or one per point)."""
        share = np.asarray(share, dtype=float)
        column = share[..., None] if share.ndim else share
        if not self.turns:
            return points + column * self.shift
        angle = share * self.angle
        cos, sin = np.cos(angle), np.sin(angle)
        if share.ndim:
            cos, sin = cos[:, None], sin[:, None]
        arm = points - self.pivot
        turned = arm * cos + np.cross(self.axis, arm) * sin + np.outer(arm @ self.axis, self.axis) * (1 - cos)
        return self.pivot + turned + column * self.shift

    def trsf(self, share: float = 1.0) -> gp_Trsf:
        """`share` of the move as a kernel transform."""
        total = gp_Trsf()
        total.SetTranslation(gp_Vec(*(float(c) * share for c in self.shift)))
        if self.turns and abs(share * self.angle) > NO_TURN:
            turn = gp_Trsf()
            turn.SetRotation(gp_Ax1(gp_Pnt(*map(float, self.pivot)), gp_Dir(*map(float, self.axis))), share * self.angle)
            total.Multiply(turn)
        return total

    @staticmethod
    def from_trsf(trsf: gp_Trsf, pivot) -> "Move":
        """The move a kernel transform makes, written as a turn about `pivot` and a shift."""
        pivot = np.array(pivot, dtype=float)
        found, angle = _rotation(trsf)
        moved = gp_Pnt(*map(float, pivot)).Transformed(trsf)
        shift = np.array([moved.X(), moved.Y(), moved.Z()]) - pivot
        if abs(angle) <= NO_TURN:
            return Move(shift)
        return Move(shift, pivot, found, angle)


def _rotation(trsf: gp_Trsf):
    quaternion = trsf.GetRotation()
    axis = gp_Vec()
    (angle,) = quaternion.GetVectorAndAngle(axis)
    if axis.Magnitude() < 1e-12:
        return np.array([0.0, 0.0, 1.0]), 0.0
    return np.array([axis.X(), axis.Y(), axis.Z()]) / axis.Magnitude(), float(angle)


class Field:
    """Where every point of space goes. Along `direction` the share of the move rises from 0 at the band's end to 1 at
    the protected part (`falloff`). `straight` keeps every line along the direction straight (the share is a straight
    ramp and each point takes the move of the point above it at the protected part), which re-fits flat faces as flat
    faces; otherwise each point takes its share of the turn and the shift, so the faces bend smoothly."""

    def __init__(self, direction: np.ndarray, falloff: Falloff, move: Move, straight: bool):
        self.direction, self.falloff, self.move, self.straight = direction, falloff, move, straight

    def level(self, points: np.ndarray) -> np.ndarray:
        return points @ self.direction

    def __call__(self, points: np.ndarray) -> np.ndarray:
        points = np.asarray(points, dtype=float)
        level = self.level(points)
        share = self.falloff(level)
        if self.straight and self.move.turns:
            foot = points + np.outer(np.maximum(0.0, self.falloff.end - level), self.direction)
            return points + share[:, None] * (self.move.apply(foot) - foot)
        return self.move.apply(points, share)

    def rigid(self, level: float) -> gp_Trsf:
        """The rigid move of something that sits where the share is constant (the protected part, a feature riding along)."""
        return self.move.trsf(float(self.falloff(np.array([level]))[0]))

    def stretch_factor(self, points: np.ndarray, step: float) -> np.ndarray:
        """How much a small volume at each point grows (1 = unchanged, 0 or less = folded through itself)."""
        columns = []
        for k in range(3):
            offset = np.zeros(3)
            offset[k] = step
            columns.append((self(points + offset) - self(points - offset)) / (2 * step))
        return np.linalg.det(np.stack(columns, axis=2))

    def kink(self, points: np.ndarray, step: float) -> np.ndarray:
        """The sudden change of the deformation's slope across the level of each point, as a vector per point (zero where it is smooth)."""
        ahead = (self(points + step * self.direction) - self(points)) / step
        behind = (self(points) - self(points - step * self.direction)) / step
        return ahead - behind


def angle_between(a: np.ndarray, b: np.ndarray) -> float:
    return math.atan2(float(np.linalg.norm(np.cross(a, b))), float(a @ b))

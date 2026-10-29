"""Handles of the tools that place a new hole or boss on a flat face: where it sits (two move arrows), its size and its depth."""

import math

from ..ops import MIN_DISTANCE
from ..tools import Handle, round_handles
from .faces import _plane_axes
from .hole_edit import _perpendicular


class Frame:
    """The new feature's place: `start` on the face (the face center moved by offset_u, offset_v), the face's outward `normal`
    and the two in-plane directions `u` and `v`, all as plain tuples."""

    def __init__(self, face, values):
        centre, normal, u, v = _plane_axes(face)
        self.normal = (normal.X(), normal.Y(), normal.Z())
        self.u = (u.X(), u.Y(), u.Z())
        self.v = (v.X(), v.Y(), v.Z())
        self.start = tuple(c + a * values["offset_u"] + b * values["offset_v"] for c, a, b in zip((centre.X(), centre.Y(), centre.Z()), self.u, self.v))

    def at(self, depth: float) -> tuple[float, float, float]:
        """The point `depth` into the material from the start (negative: out of the face)."""
        return tuple(s - n * depth for s, n in zip(self.start, self.normal))


def through_depth(shape, frame: Frame) -> float:
    """How far the solid reaches below the start along the hole's direction (its bounding box), for a depth of 0 = through."""
    from OCP.Bnd import Bnd_Box
    from OCP.BRepBndLib import BRepBndLib

    box = Bnd_Box()
    BRepBndLib.AddOptimal_s(shape, box, False, False)
    lo, hi = box.CornerMin(), box.CornerMax()
    reach = 0.0
    for x in (lo.X(), hi.X()):
        for y in (lo.Y(), hi.Y()):
            for z in (lo.Z(), hi.Z()):
                reach = max(reach, sum((s - c) * n for s, c, n in zip(frame.start, (x, y, z), frame.normal)))
    return max(reach, MIN_DISTANCE)


def position_handles(frame: Frame, depth: float) -> list[Handle]:
    """Two move arrows at the middle of the feature, along the face's u and v axes (they change offset_u and offset_v)."""
    middle = frame.at(depth / 2)
    return [Handle("offset_u", "Move along the face's first axis", middle, frame.u, kind="move"), Handle("offset_v", "Move along the face's second axis", middle, frame.v, kind="move")]


def diameter_handles(frame: Frame, param: str, name: str, diameter: float, **kw) -> list[Handle]:
    kw.setdefault("min", MIN_DISTANCE)
    return round_handles(param, name, frame.start, frame.u, frame.v, diameter, **kw)


def depth_handle(frame: Frame, param: str, label: str, shown: float, **kw) -> Handle:
    """A square grip at the bottom of the feature, dragged along its axis; `shown` is the real depth (a parameter of 0 means through)."""
    return Handle(param, label, frame.at(shown), tuple(-n for n in frame.normal), min=MIN_DISTANCE, kind="resize", shown=shown, axis_from=frame.start, **kw)


def cone_angle_handle(frame: Frame, hole_diameter: float, sink: float, angle: float) -> list[Handle]:
    """The countersink angle: an arc swung about the point where the cone meets the face, carried on the cone's side line (as Add countersink to hole)."""
    if not (10 <= angle <= 170 and sink > hole_diameter):
        return []
    half = math.radians(angle) / 2
    inward = tuple(-n for n in frame.normal)
    unit = frame.u
    mouth = tuple(c + unit[k] * sink / 2 for k, c in enumerate(frame.start))
    reach = max((sink - hole_diameter) / 2 / math.sin(half), 4.0)
    side = tuple(-math.sin(half) * unit[k] + math.cos(half) * inward[k] for k in range(3))
    grip = tuple(mouth[k] + reach * side[k] for k in range(3))
    tangent = tuple(-math.cos(half) * unit[k] - math.sin(half) * inward[k] for k in range(3))
    return [Handle("sink_angle", "Countersink angle", grip, tangent, scale=2 * math.degrees(1 / reach), min=10.0, max=170.0, unit="°", axis=_perpendicular(inward, unit), ring=(*mouth, reach), arc=True)]

"""The values the unwrap modules share: the error, the tolerance and the band and unrolling records."""

from dataclasses import dataclass, field
from typing import Callable

from .opserrors import OperationError

CURVE_SAMPLES = 48
TOL = 1e-6


class UnwrapError(OperationError):
    pass


@dataclass
class Band:
    """The part of the unrolled plane that maps onto one face."""

    face: object  # TopoDS_Face
    surface: object  # Geom_Surface, location applied
    x0: float
    x1: float
    # (x, y) of the unrolled plane -> (u, v) parameters of `surface`
    to_param: Callable[[float, float], tuple[float, float]]
    linear: bool = True  # straight lines of the sketch stay straight in parameter space
    periodic_u: float | None = None
    # Closed surfaces repeat in the unrolled plane: copy k of the face covers clip(k), and a region there is
    # mapped with its angle moved back by k turns. Other bands have only copy 0.
    copies: tuple[int, ...] = (0,)
    clip: Callable[[int], list[tuple[float, float]]] | None = None


@dataclass
class Unrolling:
    bands: list[Band]
    reference: dict
    faces: list = field(default_factory=list)
    # Set when the faces cannot unroll without stretching: {"max": worst length error as a fraction, "note": text}.
    distortion: dict | None = None

"""How much of the move each level of the band takes: 0 at the band's end, 1 at the protected part, and constant across
every feature that rides along inside the band, so the feature keeps its shape."""

from dataclasses import dataclass, field

import numpy as np

LINEAR, TANGENT, CURVATURE = 0, 1, 2  # straight share; eased so slopes match (G1); eased so curvature matches too (G2)

STEEPEST = {LINEAR: 1.0, TANGENT: 1.5, CURVATURE: 1.875}  # the largest slope of each step, as a multiple of the straight one


def _step(t: np.ndarray, order: int) -> np.ndarray:
    if order == LINEAR:
        return t
    if order == TANGENT:
        return t * t * (3 - 2 * t)
    return t * t * t * (t * (6 * t - 15) + 10)


@dataclass
class Falloff:
    """The share of the move at each level `s` along the band's direction. `plateaus` are the (low, high) levels of the
    features inside the band: the share is constant across each, and the stretch is spread over the free lengths between them."""

    start: float  # the band's end: no move at or below it
    end: float  # the protected part: the whole move at or above it
    plateaus: list = field(default_factory=list)
    order: int = LINEAR

    def __post_init__(self):
        merged = []
        for low, high in sorted((max(low, self.start), min(high, self.end)) for low, high in self.plateaus):
            if high <= low:
                continue
            if merged and low <= merged[-1][1]:
                merged[-1] = (merged[-1][0], max(merged[-1][1], high))
            else:
                merged.append((low, high))
        edges = [self.start] + [x for pair in merged for x in pair] + [self.end]
        self.free = [(a, b) for a, b in zip(edges[0::2], edges[1::2]) if b - a > 1e-12]
        self.length = sum(b - a for a, b in self.free)

    @property
    def breaks(self) -> list[float]:
        """The levels where the share changes its rule."""
        return sorted({x for pair in self.free for x in pair})

    @property
    def shortest(self) -> float:
        return min((b - a for a, b in self.free), default=0.0)

    def __call__(self, s) -> np.ndarray:
        s = np.asarray(s, dtype=float)
        if self.length <= 0:
            return np.where(s >= self.end, 1.0, 0.0)
        share = np.zeros_like(s)
        for a, b in self.free:
            share += (b - a) / self.length * _step(np.clip((s - a) / (b - a), 0.0, 1.0), self.order)
        return share

    def steepest(self) -> float:
        """The largest slope of the share (per unit of level)."""
        return STEEPEST[self.order] / self.length if self.length > 0 else float("inf")

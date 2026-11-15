"""Cubic B-splines through sampled points, with the parameters of the samples kept, so the curves drawn on a surface in
its (u, v) space stay where they were when the surface is replaced by its deformed copy."""

import numpy as np
from OCP.Geom import Geom_BSplineCurve, Geom_BSplineSurface
from OCP.Geom2d import Geom2d_BSplineCurve
from OCP.collections import Array1_double as TColStd_Array1OfReal
from OCP.collections import Array1_gp_Pnt as TColgp_Array1OfPnt
from OCP.collections import Array1_gp_Pnt2d as TColgp_Array1OfPnt2d
from OCP.collections import Array1_int as TColStd_Array1OfInteger
from OCP.collections import Array2_gp_Pnt as TColgp_Array2OfPnt
from OCP.gp import gp_Pnt, gp_Pnt2d

DEGREE = 3


class Span:
    """A cubic spline's knots over [low, high] and the parameters to sample for interpolation. `count` even pieces, plus
    a knot at each of `breaks` where the sampled shape is less smooth: `smoothness` is the number of its derivatives
    that stay continuous there (0, 1 or 2), and the knot is repeated so the spline can follow it."""

    def __init__(self, low: float, high: float, count: int, breaks=(), smoothness: int = 2):
        self.low, self.high, self.count, self.breaks, self.smoothness = low, high, count, tuple(breaks), smoothness
        even = np.linspace(low, high, count + 1)[1:-1]
        gap = (high - low) / count
        inside = sorted(b for b in breaks if low + 1e-9 * (high - low) < b < high - 1e-9 * (high - low))
        kept = [k for k in even if all(abs(k - b) > 0.25 * gap for b in inside)]
        repeats = max(1, DEGREE - smoothness)
        interior = sorted(kept + [b for b in inside for _ in range(repeats)])
        self.knots = np.array([low] * (DEGREE + 1) + interior + [high] * (DEGREE + 1))
        self.sites = np.array([self.knots[i + 1 : i + DEGREE + 1].mean() for i in range(len(self.knots) - DEGREE - 1)])
        self.sites[0], self.sites[-1] = low, high

    def between(self) -> np.ndarray:
        """Parameters halfway between the samples, where a fit is furthest from what it follows."""
        distinct = np.unique(self.sites)
        return (distinct[:-1] + distinct[1:]) / 2

    def doubled(self) -> "Span":
        return Span(self.low, self.high, 2 * self.count, self.breaks, self.smoothness)

    def arrays(self):
        """The knots and how often each repeats, as the kernel takes them."""
        values, repeats = np.unique(self.knots, return_counts=True)
        knots, mults = TColStd_Array1OfReal(1, len(values)), TColStd_Array1OfInteger(1, len(values))
        for i, (value, repeat) in enumerate(zip(values, repeats)):
            knots.SetValue(i + 1, float(value))
            mults.SetValue(i + 1, int(repeat))
        return knots, mults


def basis(knots: np.ndarray, x: np.ndarray, degree: int = DEGREE) -> np.ndarray:
    """The B-spline basis functions at `x`, one row per value and one column per control point."""
    x = np.asarray(x, dtype=float)
    count = len(knots) - degree - 1
    span = np.clip(np.searchsorted(knots, x, side="right") - 1, degree, count - 1)
    table = np.zeros((len(x), len(knots) - 1))
    table[np.arange(len(x)), span] = 1.0
    for d in range(1, degree + 1):
        m = len(knots) - 1 - d
        left, right = knots[d : d + m] - knots[:m], knots[d + 1 : d + 1 + m] - knots[1 : 1 + m]
        rise = np.divide(x[:, None] - knots[:m], left, out=np.zeros((len(x), m)), where=left > 0)
        fall = np.divide(knots[d + 1 : d + 1 + m] - x[:, None], right, out=np.zeros((len(x), m)), where=right > 0)
        table = rise * table[:, :m] + fall * table[:, 1 : m + 1]
    return table


_INVERSES: dict = {}
_INVERSES_KEPT = 64


def sites_inverse(span: Span) -> np.ndarray:
    """The inverse of the basis at the span's sites: solving a fit against the same span again (every step of a drag has the
    same spans) is a product instead of a new solve. Kept for the last few spans."""
    key = span.knots.tobytes()
    if key not in _INVERSES:
        if len(_INVERSES) >= _INVERSES_KEPT:
            _INVERSES.clear()
        _INVERSES[key] = np.linalg.inv(basis(span.knots, span.sites))
    return _INVERSES[key]


class SurfaceFit:
    """The cubic surface through a grid of points sampled at the sites of two spans."""

    def __init__(self, across: Span, along: Span, points: np.ndarray):
        self.across, self.along = across, along
        nu, nv = len(across.sites), len(along.sites)
        along_u = (sites_inverse(across) @ points.reshape(nu, -1)).reshape(points.shape)
        self.poles = (sites_inverse(along) @ along_u.transpose(1, 0, 2).reshape(nv, -1)).reshape(nv, nu, 3).transpose(1, 0, 2)

    def at(self, us: np.ndarray, vs: np.ndarray) -> np.ndarray:
        """The surface's points at the pairs (us[i], vs[i])."""
        rows = (basis(self.across.knots, us) @ self.poles.reshape(self.poles.shape[0], -1)).reshape(len(us), self.poles.shape[1], 3)
        return np.einsum("nj,njk->nk", basis(self.along.knots, vs), rows)

    def surface(self) -> Geom_BSplineSurface:
        nu, nv = self.poles.shape[:2]
        poles = TColgp_Array2OfPnt(1, nu, 1, nv)
        for i in range(nu):
            for j in range(nv):
                poles.SetValue(i + 1, j + 1, gp_Pnt(*map(float, self.poles[i, j])))
        uk, um = self.across.arrays()
        vk, vm = self.along.arrays()
        return Geom_BSplineSurface(poles, uk, vk, um, vm, DEGREE, DEGREE)


def fit_curve(span: Span, points: np.ndarray) -> Geom_BSplineCurve:
    """The cubic curve with C(span.sites[i]) = points[i]."""
    solved = sites_inverse(span) @ points
    poles = TColgp_Array1OfPnt(1, len(solved))
    for i, p in enumerate(solved):
        poles.SetValue(i + 1, gp_Pnt(*map(float, p)))
    knots, mults = span.arrays()
    return Geom_BSplineCurve(poles, knots, mults, DEGREE)


def fit_curve_2d(span: Span, points: np.ndarray) -> Geom2d_BSplineCurve:
    """The cubic curve in a surface's (u, v) space with C(span.sites[i]) = points[i]."""
    solved = sites_inverse(span) @ points
    poles = TColgp_Array1OfPnt2d(1, len(solved))
    for i, p in enumerate(solved):
        poles.SetValue(i + 1, gp_Pnt2d(float(p[0]), float(p[1])))
    knots, mults = span.arrays()
    return Geom2d_BSplineCurve(poles, knots, mults, DEGREE)


def straight_2d(first: float, last: float, start: np.ndarray, end: np.ndarray) -> Geom2d_BSplineCurve:
    """The straight curve in (u, v) space that runs from `start` at `first` to `end` at `last` at an even pace."""
    poles = TColgp_Array1OfPnt2d(1, 2)
    poles.SetValue(1, gp_Pnt2d(float(start[0]), float(start[1])))
    poles.SetValue(2, gp_Pnt2d(float(end[0]), float(end[1])))
    knots, mults = TColStd_Array1OfReal(1, 2), TColStd_Array1OfInteger(1, 2)
    knots.SetValue(1, float(first))
    knots.SetValue(2, float(last))
    mults.SetValue(1, 2)
    mults.SetValue(2, 2)
    return Geom2d_BSplineCurve(poles, knots, mults, 1)

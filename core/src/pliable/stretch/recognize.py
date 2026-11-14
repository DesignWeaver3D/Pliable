"""Seeing a plane, cylinder, cone, sphere or torus in deformed geometry, so a face that is still one of them is stored
as exactly that and only faces that really changed character become free-form."""

import math

import numpy as np
from OCP.ElCLib import ElCLib
from OCP.ElSLib import ElSLib
from OCP.Geom import (
    Geom_Circle,
    Geom_ConicalSurface,
    Geom_CylindricalSurface,
    Geom_Line,
    Geom_Plane,
    Geom_RectangularTrimmedSurface,
    Geom_SphericalSurface,
    Geom_ToroidalSurface,
    Geom_TrimmedCurve,
)
from OCP.GeomConvert import GeomConvert_SurfToAnaSurf
from OCP.gp import gp_Ax3, gp_Dir, gp_Pnt

ON = 1e-8  # a point this close to a surface or curve is on it
TWO_PI = 2 * math.pi


def bare(surface):
    """The surface without a trimming wrapper."""
    while isinstance(surface, Geom_RectangularTrimmedSurface):
        surface = surface.BasisSurface()
    return surface


def bare_curve(curve):
    while isinstance(curve, Geom_TrimmedCurve):
        curve = curve.BasisCurve()
    return curve


def _elementary(surface):
    """The plain description of a plane, cylinder, cone, sphere or torus (None for any other surface)."""
    if isinstance(surface, Geom_Plane):
        return surface.Pln()
    if isinstance(surface, Geom_CylindricalSurface):
        return surface.Cylinder()
    if isinstance(surface, Geom_ConicalSurface):
        return surface.Cone()
    if isinstance(surface, Geom_SphericalSurface):
        return surface.Sphere()
    if isinstance(surface, Geom_ToroidalSurface):
        return surface.Torus()
    return None


def is_elementary(surface) -> bool:
    return _elementary(bare(surface)) is not None


def is_plane(surface) -> bool:
    return isinstance(bare(surface), Geom_Plane)


def periods(surface) -> tuple[float, float]:
    """The period of u and of v (0 where the surface does not close on itself)."""
    surface = bare(surface)
    if isinstance(surface, Geom_Plane):
        return 0.0, 0.0
    return TWO_PI, TWO_PI if isinstance(surface, Geom_ToroidalSurface) else 0.0


def uv_of(surface, points: np.ndarray) -> np.ndarray:
    """The (u, v) of the nearest point of a plane, cylinder, cone, sphere or torus to each given point."""
    shape = _elementary(bare(surface))
    return np.array([ElSLib.Parameters_s(shape, gp_Pnt(*map(float, p))) for p in points])


def off_surface(surface, points: np.ndarray) -> float:
    """The largest distance of the points from a plane, cylinder, cone, sphere or torus."""
    shape, worst = _elementary(bare(surface)), 0.0
    for p in points:
        point = gp_Pnt(*map(float, p))
        u, v = ElSLib.Parameters_s(shape, point)
        worst = max(worst, point.Distance(ElSLib.Value_s(u, v, shape)))
    return worst


def flat_plane(points: np.ndarray, like: np.ndarray, x_like: np.ndarray, tolerance: float):
    """The plane through the points when they are flat (None otherwise), its normal on the side of `like` and its x axis near `x_like`."""
    centre = points.mean(axis=0)
    _, sizes, axes = np.linalg.svd(points - centre)
    normal = axes[2]
    if np.abs((points - centre) @ normal).max() > tolerance or sizes[1] < 1e-9:
        return None
    if normal @ like < 0:
        normal = -normal
    x = x_like - (x_like @ normal) * normal
    if np.linalg.norm(x) < 1e-9:
        x = axes[0]
    x = x / np.linalg.norm(x)
    return Geom_Plane(gp_Ax3(gp_Pnt(*map(float, centre)), gp_Dir(*map(float, normal)), gp_Dir(*map(float, x))))


def analytic_of(surface, tolerance: float):
    """The cylinder, cone, sphere or torus a free-form surface really is, within `tolerance` (None when it is none of them)."""
    try:
        found = GeomConvert_SurfToAnaSurf(surface).ConvertToAnalytical(tolerance)
    except Exception:
        return None
    if found is None:
        return None
    found = bare(found)
    return found if _elementary(found) is not None and not isinstance(found, Geom_Plane) else None


def line_of(curve):
    curve = bare_curve(curve)
    return curve.Lin() if isinstance(curve, Geom_Line) else None


def circle_of(curve):
    curve = bare_curve(curve)
    return curve.Circ() if isinstance(curve, Geom_Circle) else None


def on_line(line, points: np.ndarray) -> bool:
    return all(line.Distance(gp_Pnt(*map(float, p))) < ON for p in points)


def on_circle(circle, points: np.ndarray) -> bool:
    return all(circle.Distance(gp_Pnt(*map(float, p))) < ON for p in points)


def line_parameter(line, point: np.ndarray) -> float:
    return ElCLib.Parameter_s(line, gp_Pnt(*map(float, point)))


def circle_parameter(circle, point: np.ndarray, near: float) -> float:
    """The angle of a point on a circle, as the value nearest `near` (angles repeat every full turn)."""
    angle = ElCLib.Parameter_s(circle, gp_Pnt(*map(float, point)))
    return angle + TWO_PI * round((near - angle) / TWO_PI)


def straight(points: np.ndarray) -> bool:
    """True when the points lie on one straight line."""
    chord = points[-1] - points[0]
    length = np.linalg.norm(chord)
    if length < 1e-9:
        return False
    off = (points - points[0]) - np.outer((points - points[0]) @ chord / length, chord / length)
    return float(np.abs(off).max()) < ON

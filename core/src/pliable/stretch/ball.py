"""A deformed sphere or torus that is still one: the surface placed so its (u, v) run the way the old surface's did."""

import numpy as np
from OCP.Geom import Geom_SphericalSurface, Geom_ToroidalSurface
from OCP.gp import gp_Ax3, gp_Dir, gp_Pnt, gp_Vec

from .recognize import off_surface, uv_of

HALF_TURN = np.pi / 2


def _xyz(point) -> np.ndarray:
    return np.array([point.X(), point.Y(), point.Z()])


def _direction(vector: np.ndarray):
    return None if np.linalg.norm(vector) < 1e-9 else vector / np.linalg.norm(vector)


def ball_surface(found, old, field, after: np.ndarray, close: float):
    """The sphere or torus `found` in the deformed face, placed like the old sphere or torus `old` (the pole or the tube's
    top, and the point at u = v = 0, go where the field takes them), or None when it is not one the same way round.
    `after` holds the deformed 5 x 5 samples of the face; `close` is how far the face may be from the result."""
    sphere = isinstance(old, Geom_SphericalSurface)
    centre = _xyz(found.Location()) if sphere else _xyz(found.Position().Location())
    up, down = (field(_xyz(old.Value(0.0, sign * HALF_TURN))[None, :])[0] for sign in (1.0, -1.0))  # the pole, or the tube's top, and its opposite
    axis = _direction(up - down)
    if axis is None:
        return None
    out = field(_xyz(old.Value(0.0, 0.0))[None, :])[0] - centre
    x = _direction(out - (out @ axis) * axis)
    if x is None:
        return None
    normal = np.cross(after[3, 2] - after[1, 2], after[2, 3] - after[2, 1])
    for mirrored in (False, True):
        position = gp_Ax3(gp_Pnt(*map(float, centre)), gp_Dir(*map(float, axis)), gp_Dir(*map(float, x)))
        if mirrored:
            position.YReverse()
        made = Geom_SphericalSurface(position, found.Radius()) if sphere else Geom_ToroidalSurface(position, found.MajorRadius(), found.MinorRadius())
        u, v = uv_of(made, after[2, 2][None, :])[0]
        point, du, dv = gp_Pnt(), gp_Vec(), gp_Vec()
        made.D1(float(u), float(v), point, du, dv)
        if np.cross(_xyz(du), _xyz(dv)) @ normal > 0:
            return made if off_surface(made, after.reshape(-1, 3)) < close else None
    return None

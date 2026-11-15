"""The on-screen handles of Stretch: move arrows and tilt rings in the chosen frame, and the band's length slider."""

import math

import numpy as np

from ..tools.base import Handle
from .solve import Plan

AXIS_NAMES = "XYZ"


def move_and_tilt_handles(axes: np.ndarray, here: np.ndarray, reach: float, values: dict) -> list:
    """Three move arrows along the frame's axes at `here`, and a tilt ring about each axis (as on Move/Rotate)."""
    out = [
        Handle(name, f"Stretch along {AXIS_NAMES[k]}", tuple(map(float, here)), tuple(map(float, axes[k])), kind="move")
        for k, name in enumerate(("dx", "dy", "dz"))
    ]
    radius = max(reach * 1.15, 8.0)
    for k, name in enumerate(("rx", "ry", "rz")):
        u, v = axes[(k + 1) % 3], axes[(k + 2) % 3]
        theta = math.radians(45 + values.get(name, 0.0))
        anchor = here + radius * (math.cos(theta) * u + math.sin(theta) * v)
        tangent = -math.sin(theta) * u + math.cos(theta) * v
        out.append(Handle(name, f"Tilt about {AXIS_NAMES[k]}", tuple(map(float, anchor)), tuple(map(float, tangent)), scale=math.degrees(1 / radius), unit="°", axis=tuple(map(float, axes[k])), ring=(*map(float, here), radius)))
    return out


def band_handle(made: Plan, face_ids: list) -> Handle:
    """The slider at the band's end: dragged along the band it sets the band's length; `rest` is the Auto length it
    snaps back to, and `strip` tells the view which part of which faces to shade as the region that deforms."""
    body, band = made.body, made.band
    rubber_vertices = sorted(v for f in made.zones.rubber for v in body.face_vertices[f] if v in made.zones.protected_vertices)
    corner = body.point(rubber_vertices[0])
    top = corner + (band.end - corner @ band.direction) * band.direction
    length = band.end - made.start
    anchor = top - length * band.direction
    strip = (tuple(map(float, top)), tuple(map(float, -band.direction)), float(length), tuple(face_ids))
    return Handle("band", "Band length", tuple(map(float, anchor)), tuple(map(float, -band.direction)), kind="resize", min=0.0, max=float(band.end - band.limit), shown=float(length), rest=float(band.end - band.auto_start), strip=strip)


def reach_of(made: Plan) -> float:
    """Half the diagonal of the protected part: how far the tilt rings sit from its middle."""
    points = np.array([made.body.point(v) for v in made.zones.protected_vertices])
    return float(np.linalg.norm(points.max(axis=0) - points.min(axis=0))) / 2

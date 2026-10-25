"""The axes of the edge gizmo: one along the edge and two square to it and to each other, turned about the edge by one angle. Turned by 0 they
lie along the global axes where the edge itself does (the second axis is the next global axis after the edge's dominant one)."""

import math

Vec = tuple[float, float, float]


def _cross(a: Vec, b: Vec) -> Vec:
    return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])


def _dot(a: Vec, b: Vec) -> float:
    return sum(x * y for x, y in zip(a, b))


def _unit(v: Vec) -> Vec:
    length = math.sqrt(_dot(v, v))
    return (v[0] / length, v[1] / length, v[2] / length)


def base_frame(direction: Vec) -> tuple[Vec, Vec, Vec]:
    """(t, u, v) for an edge direction: t along the edge (its largest component positive), u the next global axis made square to it, v = t x u."""
    k = max(range(3), key=lambda i: abs(direction[i]))
    t = _unit(direction if direction[k] >= 0 else (-direction[0], -direction[1], -direction[2]))
    helper = tuple(1.0 if i == (k + 1) % 3 else 0.0 for i in range(3))
    along = _dot(helper, t)
    u = _unit(tuple(helper[i] - along * t[i] for i in range(3)))
    return t, u, _cross(t, u)


def turned_axes(direction: Vec, degrees: float) -> tuple[Vec, Vec, Vec]:
    """(t, u, v) after turning the two cross axes by `degrees` about the edge (right-handed about t)."""
    t, u0, v0 = base_frame(direction)
    c, s = math.cos(math.radians(degrees)), math.sin(math.radians(degrees))
    u = tuple(c * u0[i] + s * v0[i] for i in range(3))
    v = tuple(-s * u0[i] + c * v0[i] for i in range(3))
    return t, u, v  # type: ignore[return-value]


def snap_angles(direction: Vec, normals: list[Vec]) -> list[float]:
    """Turn angles (degrees, -180..180) at which one cross axis lies along a face normal (either way): that axis or the other one is then square to
    the face. Includes 0, the global alignment."""
    _, u0, v0 = base_frame(direction)
    found = [0.0]
    for n in normals:
        base = math.degrees(math.atan2(_dot(n, v0), _dot(n, u0)))
        for extra in (0.0, 90.0, 180.0, -90.0):
            angle = (base + extra + 180.0) % 360.0 - 180.0
            if all(abs(((angle - f) + 180.0) % 360.0 - 180.0) > 1e-3 for f in found):
                found.append(round(angle, 4))
    return sorted(found)

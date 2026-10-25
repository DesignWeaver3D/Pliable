"""The turned axes of the Move edge gizmo: the matrix of its three turn angles, the axis each turn ring spins about, and the angles
at which a ring brings one of the gizmo's axes square to a direction that matters (a global axis, an adjacent face's normal, or the
line across that face from the edge)."""

import math

Vec = tuple[float, float, float]
Matrix = list[list[float]]  # rows; the gizmo's axes are the columns

SNAP_TOLERANCE = 0.02  # how far (in cosine) a gizmo axis may be from the wanted direction after the turn and still count as square to it


def _turn(axis: int, degrees: float) -> Matrix:
    c, s = math.cos(math.radians(degrees)), math.sin(math.radians(degrees))
    u, v = (axis + 1) % 3, (axis + 2) % 3
    m = [[1.0 if i == j else 0.0 for j in range(3)] for i in range(3)]
    m[u][u], m[u][v], m[v][u], m[v][v] = c, -s, s, c
    return m


def _mul(a: Matrix, b: Matrix) -> Matrix:
    return [[sum(a[i][k] * b[k][j] for k in range(3)) for j in range(3)] for i in range(3)]


def _apply(m: Matrix, v: Vec) -> Vec:
    return tuple(sum(m[i][k] * v[k] for k in range(3)) for i in range(3))  # type: ignore[return-value]


def _transpose(m: Matrix) -> Matrix:
    return [[m[j][i] for j in range(3)] for i in range(3)]


def _around(angles) -> list[tuple[Matrix, Matrix]]:
    """For each turn angle, the turns (before, after) either side of its own, so the whole gizmo turn is before * ring(theta) * after."""
    rx, ry, rz = (_turn(k, angles[k]) for k in range(3))
    identity = _turn(0, 0.0)
    return [(_mul(rz, ry), identity), (rz, rx), (identity, _mul(ry, rx))]


def frame_matrix(angles) -> Matrix:
    return _mul(_mul(_turn(2, angles[2]), _turn(1, angles[1])), _turn(0, angles[0]))


def frame_axes(angles) -> list[Vec]:
    """The gizmo's X, Y and Z directions in the world for the turn angles (degrees) about its X, then Y, then Z."""
    m = frame_matrix(angles)
    return [(m[0][j], m[1][j], m[2][j]) for j in range(3)]


def rotate_vector(angles, v: Vec) -> Vec:
    return _apply(frame_matrix(angles), v)


def ring_axes(angles) -> list[Vec]:
    """The world axis each turn angle spins the gizmo about: its own X, the turned Y of the second stage, and the global Z."""
    around = _around(angles)
    return [_apply(around[k][0], tuple(1.0 if i == k else 0.0 for i in range(3))) for k in range(3)]  # type: ignore[arg-type]


def snap_angles(angles, ring: int, targets: list[Vec]) -> list[float]:
    """Angles (degrees, -180..180) for turn angle `ring` (the others held) at which one gizmo axis lies along one of the `targets` (either way)."""
    before, after = _around(angles)[ring]
    u, v = (ring + 1) % 3, (ring + 2) % 3
    found: list[float] = []
    for j in range(3):
        a = _apply(after, tuple(1.0 if k == j else 0.0 for k in range(3)))  # type: ignore[arg-type]
        for target in targets:
            for sign in (1.0, -1.0):
                w = _apply(_transpose(before), tuple(sign * c for c in target))  # type: ignore[arg-type]
                if abs(a[ring] - w[ring]) > SNAP_TOLERANCE or math.hypot(a[u], a[v]) < 1e-3 or math.hypot(w[u], w[v]) < 1e-3:
                    continue
                theta = math.degrees(math.atan2(w[v], w[u]) - math.atan2(a[v], a[u]))
                theta = (theta + 180.0) % 360.0 - 180.0
                if all(abs(((theta - f) + 180.0) % 360.0 - 180.0) > 1e-3 for f in found):
                    found.append(round(theta, 4))
    return sorted(found)

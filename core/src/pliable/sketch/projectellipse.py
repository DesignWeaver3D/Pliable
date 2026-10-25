"""A whole ellipse edge of the model flattened onto a sketch plane: its true ellipse, not sampled points."""

import math


def flattened_ellipse(center, major_vec, minor_vec, x, y):
    """The ellipse c + cos(t) major_vec + sin(t) minor_vec seen square to a plane with in-plane axes x and y (unit
    vectors). Returns (centre_u, centre_v, major_u, major_v, minor_length): the major half-axis vector in sketch
    coordinates and the minor half-axis length. None when it is seen edge-on (it is then only a segment)."""
    def uv(v):
        return sum(a * b for a, b in zip(v, x)), sum(a * b for a, b in zip(v, y))

    (au, av), (bu, bv) = uv(major_vec), uv(minor_vec)
    # the 2x2 matrix [[au, bu], [av, bv]] maps the unit circle; its singular vectors are the principal axes
    e, f = (au * au + bu * bu), (au * av + bu * bv)
    g = (av * av + bv * bv)
    angle = 0.5 * math.atan2(2 * f, e - g)
    cos_a, sin_a = math.cos(angle), math.sin(angle)
    major_dir = (cos_a, sin_a)
    mean, diff = (e + g) / 2, math.hypot((e - g) / 2, f)
    big, small = math.sqrt(max(mean + diff, 0)), math.sqrt(max(mean - diff, 0))
    if small < 1e-6 * max(big, 1e-12) or big < 1e-9:
        return None
    return center[0], center[1], major_dir[0] * big, major_dir[1] * big, small


def ellipse_vectors(ellipse):
    """The major and minor half-axis vectors (3D tuples) of an OCP gp_Elips."""
    xd, yd = ellipse.XAxis().Direction(), ellipse.YAxis().Direction()
    a, b = ellipse.MajorRadius(), ellipse.MinorRadius()
    return (xd.X() * a, xd.Y() * a, xd.Z() * a), (yd.X() * b, yd.Y() * b, yd.Z() * b)

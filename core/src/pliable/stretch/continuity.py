"""Checks of a stretch field against the rubber faces before any geometry is built: would a straight ramp leave a
crease inside a face or along an edge that was smooth, and does the move fold a face through itself."""

import numpy as np
from OCP.BRep import BRep_Tool
from OCP.BRepTools import BRepTools
from OCP.IntTools import IntTools_FClass2d
from OCP.TopAbs import TopAbs_IN
from OCP.gp import gp_Pnt, gp_Pnt2d, gp_Vec

from .band import edge_span
from .body import Body
from .field import Field
from .zones import Zones

GRID = 13  # samples each way on a rubber face
CREASE = 1e-6  # a slope change this far out of the face (as a share of its size) is a crease
FOLDED = 0.02  # a volume squeezed below this share of itself counts as folded


def _grid(body: Body, face: int):
    """A grid over a face: its (u, v), its points, and which of them are inside the face."""
    surface = BRep_Tool.Surface_s(body.faces[face])
    u0, u1, v0, v1 = BRepTools.UVBounds_s(body.faces[face])
    us, vs = np.linspace(u0, u1, GRID), np.linspace(v0, v1, GRID)
    points = np.array([[(p.X(), p.Y(), p.Z()) for p in (surface.Value(float(u), float(v)) for v in vs)] for u in us])
    inside = IntTools_FClass2d(body.faces[face], 1e-7)
    within = np.array([[inside.Perform(gp_Pnt2d(float(u), float(v))) == TopAbs_IN for v in vs] for u in us])
    return surface, us, vs, points, within


def _normal(surface, u: float, v: float) -> np.ndarray:
    point, du, dv = gp_Pnt(), gp_Vec(), gp_Vec()
    surface.D1(u, v, point, du, dv)
    normal = np.cross((du.X(), du.Y(), du.Z()), (dv.X(), dv.Y(), dv.Z()))
    return normal / (np.linalg.norm(normal) or 1.0)


def _leaves_surface(field: Field, point: np.ndarray, normal: np.ndarray, level: float, step: float) -> bool:
    on_level = point + (level - point @ field.direction) * field.direction
    kink = field.kink(on_level[None, :], step)[0]
    size = np.linalg.norm(kink)
    return size > 1e-12 and abs(kink @ normal) > CREASE * max(size, 1.0)


def creases(body: Body, zones: Zones, field: Field) -> bool:
    """True when the field's sudden slope changes (at the band's ends and beside riding features) would show: inside a
    rubber face, or along an edge where a rubber face met its neighbor smoothly."""
    from ..measure import _normal_at, _tangent

    breaks = field.falloff.breaks
    step = 1e-3 * (field.falloff.shortest or body.size)
    for face in zones.rubber:
        surface, us, vs, points, within = _grid(body, face)
        levels = points @ field.direction
        for level in breaks:
            side = levels - level
            for a, b in ((np.s_[:-1, :], np.s_[1:, :]), (np.s_[:, :-1], np.s_[:, 1:])):
                crossing = (side[a] * side[b] < 0) & within[a] & within[b]
                for i, j in np.argwhere(crossing)[:: max(1, int(crossing.sum()) // 12)]:
                    first = (i, j)
                    second = (i + 1, j) if a[0] == np.s_[:-1] else (i, j + 1)
                    t = side[first] / (side[first] - side[second])
                    u = us[first[0]] + t * (us[second[0]] - us[first[0]])
                    v = vs[first[1]] + t * (vs[second[1]] - vs[first[1]])
                    p = surface.Value(float(u), float(v))
                    if _leaves_surface(field, np.array([p.X(), p.Y(), p.Z()]), _normal(surface, float(u), float(v)), level, step):
                        return True
        for edge in body.face_edges[face]:
            others = [f for f in body.edge_faces[edge] if f != face and f not in zones.rubber]
            if not others or BRep_Tool.Degenerated_s(body.edges[edge]):
                continue
            low, high = edge_span(body, edge, field.direction)
            on = [level for level in breaks if abs(low - level) < 1e-6 and abs(high - level) < 1e-6]
            if not on or not _tangent(body.edges[edge], body.faces[face], body.faces[others[0]]):
                continue
            samples = body.edge_samples(edge)
            middle = samples[len(samples) // 2]
            normal = _normal_at(body.faces[face], gp_Pnt(*map(float, middle)))
            if _leaves_surface(field, middle, np.array([normal.X(), normal.Y(), normal.Z()]), on[0], step):
                return True
    return False


def folds(body: Body, zones: Zones, field: Field) -> bool:
    """True when the field squeezes some part of a rubber face to nothing or turns it inside out."""
    step = 1e-4 * body.size
    if not field.move.turns:  # a plain shift: the steepest part of the ramp decides
        along = float(field.move.shift @ field.direction)
        return 1 + along * field.falloff.steepest() < FOLDED
    for face in zones.rubber:
        points = _grid(body, face)[3].reshape(-1, 3)
        if field.stretch_factor(points, step).min() < FOLDED:
            return True
    return False



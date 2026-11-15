"""The direction of a stretch and the band along it that deforms.

Levels are distances along the direction, rising toward the protected part. The band runs from its start (nothing moves
at or below it) to its end (the lowest level of the protected part). Left on Auto it starts at the nearest geometry
that is not plain rubber: a hole, boss, pocket or step, or the far end of the rubber faces.
"""

from dataclasses import dataclass, field

import numpy as np
from OCP.BRepAdaptor import BRepAdaptor_Curve
from OCP.GeomAbs import GeomAbs_Line
from OCP.TopAbs import TopAbs_EDGE, TopAbs_REVERSED
from OCP.TopExp import TopExp_Explorer

from ..ops import OperationError
from .body import Body
from .zones import sort_zones, Zones

LEVEL_TOL = 1e-7  # levels closer than this are the same level
OVERLAP = "The selected part and the rest of the body overlap along the stretch direction; select everything at that end (a box selection does)."


@dataclass
class Feature:
    """Fixed faces that sit in the rubber faces like an island (a hole, pocket or boss), with the levels they span."""

    faces: frozenset
    low: float
    high: float


@dataclass
class Band:
    direction: np.ndarray
    end: float  # the lowest level of the protected part: the whole move at and above it
    limit: float  # the band cannot start below this (the far end of the rubber faces, a step, a notch)
    features: list = field(default_factory=list)  # between the limit and the end, nearest the end first

    @property
    def auto_start(self) -> float:
        return max([self.limit] + [f.high for f in self.features])

    def start(self, length: float) -> tuple[float, list]:
        """Where the band starts for a typed length (0 or less = Auto), and the features that ride along inside it."""
        if length <= 0:
            return self.auto_start, []
        start = max(self.end - length, self.limit)
        while True:  # a feature the start would cut through ends the band instead
            cut = [f for f in self.features if f.low < start - LEVEL_TOL < f.high - LEVEL_TOL]
            if not cut:
                return start, [f for f in self.features if f.low >= start - LEVEL_TOL]
            start = max(f.high for f in cut)


def edge_span(body: Body, edge: int, direction: np.ndarray) -> tuple[float, float]:
    """The lowest and highest level of an edge."""
    levels = body.edge_samples(edge) @ direction
    low, high = float(levels.min()), float(levels.max())
    if len(levels) < 3:
        return low, high
    curve = BRepAdaptor_Curve(body.edges[edge])
    if curve.GetType() == GeomAbs_Line:
        return low, high
    first, last = curve.FirstParameter(), curve.LastParameter()
    step = (last - first) / (len(levels) - 1)

    def level(t: float) -> float:
        p = curve.Value(t)
        return p.X() * direction[0] + p.Y() * direction[1] + p.Z() * direction[2]

    def refine(index: int, sign: float) -> float:
        a, b = max(first, first + (index - 1) * step), min(last, first + (index + 1) * step)
        for _ in range(40):  # narrow the bracket around the extreme by thirds
            m1, m2 = a + (b - a) / 3, b - (b - a) / 3
            if sign * level(m1) < sign * level(m2):
                a = m1
            else:
                b = m2
        return level((a + b) / 2)

    return min(low, refine(int(levels.argmin()), -1.0)), max(high, refine(int(levels.argmax()), 1.0))


def _area_vector(zones: Zones) -> np.ndarray:
    """The protected faces' outward normals added up by area: it points square out of the section where the protected
    part joins the rest. (Half the sum of r x dr round every face; the edges two protected faces share cancel.)"""
    body, total = zones.body, np.zeros(3)
    for face in zones.protected_faces:
        explorer = TopExp_Explorer(body.faces[face], TopAbs_EDGE)
        while explorer.More():
            points = body.edge_samples(body.edge_number(explorer.Current()))
            if explorer.Current().Orientation() == TopAbs_REVERSED:
                points = points[::-1]
            total += np.cross(points[:-1], points[1:]).sum(axis=0) / 2
            explorer.Next()
    return total


def _spanning(zones: Zones) -> np.ndarray:
    """The mean direction of the rubber edges that run from the rest to the protected part."""
    body, total = zones.body, np.zeros(3)
    for face in zones.rubber:
        for edge in body.face_edges[face]:
            ends = body.edge_vertices[edge]
            if len(ends) == 2 and (ends[0] in zones.protected_vertices) != (ends[1] in zones.protected_vertices):
                held, free = (ends if ends[0] in zones.protected_vertices else ends[::-1])
                chord = body.point(held) - body.point(free)
                total += chord / (np.linalg.norm(chord) or 1.0)
    return total


def stretch_direction(zones: Zones) -> np.ndarray:
    """The unit direction the band runs along, pointing from the rest of the body toward the protected part."""
    body = zones.body
    direction = _area_vector(zones)
    if np.linalg.norm(direction) < 1e-9 * body.size**2:
        direction = _spanning(zones)
    if np.linalg.norm(direction) < 1e-9:
        raise OperationError("Stretch cannot tell which way this selection leaves the body; select the faces at one end")
    direction = direction / np.linalg.norm(direction)
    rubber_vertices = {v for f in zones.rubber for v in body.face_vertices[f]}
    held = [body.point(v) @ direction for v in rubber_vertices & zones.protected_vertices]
    free = [body.point(v) @ direction for v in rubber_vertices - zones.protected_vertices]
    if held and free and np.mean(held) < np.mean(free):  # a pocket floor or a hole wall: the rubber is on its open side
        direction = -direction
    return direction


def _features(zones: Zones, direction: np.ndarray) -> list:
    """The groups of fixed faces that touch the rubber faces, as (faces, low, high, is an island)."""
    body, fixed, seen, groups = zones.body, zones.fixed, set(), []
    for seed in sorted(fixed):
        if seed in seen:
            continue
        group, todo = {seed}, [seed]
        while todo:
            for edge in body.face_edges[todo.pop()]:
                for other in body.edge_faces[edge]:
                    if other in fixed and other not in group:
                        group.add(other)
                        todo.append(other)
        seen |= group
        border = [(e, r) for f in group for e in body.face_edges[f] for r in body.edge_faces[e] if r in zones.rubber]
        if not border:
            continue
        spans = [edge_span(body, e, direction) for e, _ in border]
        island = all(e not in body.outer_edges(r) for e, r in border)
        groups.append((frozenset(group), min(s[0] for s in spans), max(s[1] for s in spans), island))
    return groups


def _measure(zones: Zones, direction: np.ndarray):
    """The band for these zones, or the island features that reach up into the protected part (they must join it first)."""
    body = zones.body
    rubber_edges = {e for f in zones.rubber for e in body.face_edges[f]}
    rubber_vertices = {v for f in zones.rubber for v in body.face_vertices[f]}
    held = [edge_span(body, e, direction)[0] for e in rubber_edges & zones.protected_edges]
    held += [float(body.point(v) @ direction) for v in rubber_vertices & zones.protected_vertices]
    if not held:
        raise OperationError("Nothing joins the selection to the rest of the body, so there is nothing to stretch")
    end = min(held)
    groups = _features(zones, direction)
    reaching = [g for g in groups if g[3] and g[2] > end - LEVEL_TOL]
    if reaching:
        return None, reaching
    blocks = [g for g in groups if not g[3]]
    if any(g[2] > end - LEVEL_TOL for g in blocks):
        raise OperationError(OVERLAP)
    limit = max([g[2] for g in blocks], default=None)
    islands = [Feature(g[0], g[1], g[2]) for g in groups if g[3]]
    if limit is None:  # only islands below: the band may run to the lowest point of the rubber faces
        limit = min(edge_span(body, e, direction)[0] for e in rubber_edges)
    while True:  # an island the limit cuts through ends the band too
        cut = [f for f in islands if f.low < limit - LEVEL_TOL and f.high > limit]
        if not cut:
            break
        limit = max(f.high for f in cut)
    if limit > end - LEVEL_TOL:
        raise OperationError(OVERLAP)
    features = sorted((f for f in islands if f.low >= limit - LEVEL_TOL), key=lambda f: -f.high)
    return Band(direction, end, limit, features), []


def layout(body: Body, faces: set, edges: set, vertices: set) -> tuple[Zones, Band]:
    """The zones and the band for a selection. An island feature level with the protected part joins it and moves with it."""
    faces, direction = set(faces), None
    for _ in range(len(body.faces) + 1):
        zones = sort_zones(body, faces, edges, vertices)
        if not zones.rubber:
            if len(zones.protected_faces) == len(body.faces):
                raise OperationError("Every face is selected, which is a move, not a stretch")
            raise OperationError("Nothing joins the selection to the rest of the body, so there is nothing to stretch")
        if direction is None:  # from the selection itself: a pocket that joins it later must not turn the direction
            direction = stretch_direction(zones)
        band, reaching = _measure(zones, direction)
        if band is not None:
            return zones, band
        faces |= {f for g in reaching for f in g[0]}
    raise OperationError(OVERLAP)

"""The new geometry of a body under a stretch field.

Protected faces, features riding in the band and fixed faces keep their surfaces (moved rigidly or not at all). Each
rubber face is tried in turn as: its own surface (the field slides it along itself, as on a straight stretch of a
prismatic part), a plane, a cylinder, cone, sphere or torus seen in the deformed surface, and only then a free-form surface fitted
through the deformed points.
"""

from dataclasses import dataclass

import numpy as np
from OCP.BRep import BRep_Tool
from OCP.BRepTools import BRepTools
from OCP.Geom import Geom_ConicalSurface, Geom_CylindricalSurface, Geom_Line, Geom_Plane, Geom_SphericalSurface, Geom_ToroidalSurface
from OCP.GeomAPI import GeomAPI
from OCP.gp import gp_Ax1, gp_Ax3, gp_Dir, gp_Pnt, gp_Pnt2d, gp_Vec, gp_Vec2d

from .ball import ball_surface
from .body import Body
from .field import Field
from .fit import fit_curve, fit_curve_2d, Span, straight_2d, SurfaceFit
from .rebuild import Geometry, old_pcurves
from .recognize import (
    analytic_of,
    bare,
    circle_of,
    circle_parameter,
    flat_plane,
    is_elementary,
    is_plane,
    line_of,
    line_parameter,
    off_surface,
    on_circle,
    on_line,
    ON,
    periods,
    straight,
    uv_of,
)
from .zones import Zones

COARSE = 9  # samples each way for telling what a deformed face is
PIECES = 8  # spline pieces a fit starts with, each way
MOST_PIECES = 256  # and the most it may be refined to
DRAWN = 32  # spline pieces of a curve drawn on a round surface
SCAN = 65  # samples for finding where an edge or a face crosses a level of the band

SAME, PLANE, ROUND, FREE = "same", "plane", "round", "free"  # how a rubber face's new surface was found


@dataclass
class Outcome:
    geometry: Geometry
    freeform: int  # faces that were not free-form before and are now


def _xyz(point) -> tuple:
    return point.X(), point.Y(), point.Z()


def _surface_points(surface, us: np.ndarray, vs: np.ndarray) -> np.ndarray:
    return np.array([[_xyz(surface.Value(float(u), float(v))) for v in vs] for u in us])


def _curve_points(curve, params: np.ndarray) -> np.ndarray:
    return np.array([_xyz(curve.Value(float(t))) for t in params])


def _moved(geometry, trsf):
    return geometry if trsf is None else geometry.Transformed(trsf)


def _crossings(level, low: float, high: float, breaks) -> list:
    """The parameters between `low` and `high` where `level(parameter)` passes one of the `breaks`."""
    params = np.linspace(low, high, SCAN)
    levels = np.array([level(float(t)) for t in params])
    found = []
    for value in breaks:
        signs = levels - value
        for k in np.nonzero(signs[:-1] * signs[1:] < 0)[0]:
            a, b, fa = params[k], params[k + 1], signs[k]
            for _ in range(50):
                m = (a + b) / 2
                fm = level(float(m)) - value
                if fa * fm <= 0:
                    b = m
                else:
                    a, fa = m, fm
            found.append((a + b) / 2)
    return found


def _pieces(levels: np.ndarray, field: Field) -> int:
    """Spline pieces along a line spanning `levels`: more when it crosses the band at a slant, so several fall inside the band's shortest stretch."""
    low, high = float(levels.min()), float(levels.max())
    shortest = field.falloff.shortest
    if shortest <= 0 or not any(low < b < high for b in field.falloff.breaks):
        return PIECES
    return int(min(MOST_PIECES, max(PIECES, 2 ** int(np.ceil(np.log2(6 * (high - low) / shortest))))))


class Deformer:
    """Works out the geometry of `body` after `field`, zone by zone. `target` is how closely fitted curves and surfaces
    must follow the true deformed shape."""

    def __init__(self, body: Body, zones: Zones, riders: list, field: Field, target: float):
        self.body, self.zones, self.field, self.target = body, zones, field, target
        whole = field.move.trsf(1.0)
        self.face_move: dict = {f: whole for f in zones.protected_faces}
        for rider in riders:
            trsf = field.rigid((rider.low + rider.high) / 2)
            self.face_move.update({f: trsf for f in rider.faces})
        for face in zones.fixed:
            self.face_move.setdefault(face, None)
        self.edge_move: dict = {}
        for edge in range(len(body.edges)):
            if edge in zones.protected_edges:
                self.edge_move[edge] = whole
            else:
                rigid = [f for f in body.edge_faces[edge] if f in self.face_move]
                if rigid:
                    self.edge_move[edge] = self.face_move[rigid[0]]
        self.vertex_move: dict = {}
        for vertex in range(len(body.vertices)):
            if vertex in zones.protected_vertices:
                self.vertex_move[vertex] = whole
            else:
                rigid = [e for e in body.vertex_edges[vertex] if e in self.edge_move]
                if rigid:
                    self.vertex_move[vertex] = self.edge_move[rigid[0]]
        self.old_surface = [BRep_Tool.Surface_s(face) for face in body.faces]
        self.mode: dict = {}
        self.turn: dict = {}  # flat faces fitted in (u, v) turned by this angle
        self.kept_curve: set = set()  # edges whose curve is the old one itself (only its range may differ)
        self.kept_pace: set = set()  # edges whose new curve is at the old parameter where the old point went
        self.geometry = Geometry()

    # Faces -----------------------------------------------------------------

    def _rubber_surface(self, face: int):
        surface = self.old_surface[face]
        u0, u1, v0, v1 = BRepTools.UVBounds_s(self.body.faces[face])
        us, vs = np.linspace(u0, u1, COARSE), np.linspace(v0, v1, COARSE)
        before = _surface_points(surface, us, vs)
        after = self.field(before.reshape(-1, 3)).reshape(before.shape)
        if np.abs(after - before).max() < ON:
            return SAME, surface
        if is_elementary(surface) and off_surface(surface, after.reshape(-1, 3)) < ON:
            return SAME, surface
        mid = COARSE // 2
        along_u, along_v = after[mid + 1, mid] - after[mid - 1, mid], after[mid, mid + 1] - after[mid, mid - 1]
        size = float(np.linalg.norm(after.reshape(-1, 3).max(axis=0) - after.reshape(-1, 3).min(axis=0)))
        plane = flat_plane(after.reshape(-1, 3), np.cross(along_u, along_v), along_u, ON * (1 + size))
        if plane is not None:
            return PLANE, plane
        surface, bounds = self._turned(face, surface, (u0, u1, v0, v1))
        fitted = self._fit_surface(surface, bounds)
        round_surface = self._round_surface(face, fitted, surface, bounds)
        if round_surface is not None:
            return ROUND, round_surface
        return FREE, fitted

    def _turned(self, face: int, surface, bounds):
        """A flat face is fitted in (u, v) turned so u runs along the band: the band's levels then fall on lines of
        constant u, where the fit can put its knots. Returns the plane to sample and the face's bounds in the turned (u, v)."""
        plane = bare(surface)
        if not is_plane(plane):
            return surface, bounds
        position = plane.Pln().Position()
        x, y = np.array(_xyz(position.XDirection())), np.array(_xyz(position.YDirection()))
        angle = float(np.arctan2(self.field.direction @ y, self.field.direction @ x))
        if np.hypot(self.field.direction @ x, self.field.direction @ y) < 1e-6 or abs(angle) < 1e-12:
            return surface, bounds
        self.turn[face] = angle
        u0, u1, v0, v1 = bounds
        cos, sin = np.cos(angle), np.sin(angle)
        corners = [(u * cos + v * sin, -u * sin + v * cos) for u in (u0, u1) for v in (v0, v1)]
        normal = np.cross(x, y)
        turned = Geom_Plane(position.Rotated(gp_Ax1(position.Location(), gp_Dir(*map(float, normal))), angle))
        return turned, (min(c[0] for c in corners), max(c[0] for c in corners), min(c[1] for c in corners), max(c[1] for c in corners))

    def _fit_surface(self, surface, bounds):
        u0, u1, v0, v1 = bounds
        us, vs = np.linspace(u0, u1, COARSE), np.linspace(v0, v1, COARSE)
        levels = self.field.level(_surface_points(surface, us, vs).reshape(-1, 3)).reshape(COARSE, COARSE)
        breaks, smoothness, same = self.field.falloff.breaks, self.field.falloff.order, 1e-9 * self.body.size
        um, vm = (u0 + u1) / 2, (v0 + v1) / 2

        def level(u: float, v: float) -> float:
            return float(self.field.direction @ np.array(_xyz(surface.Value(u, v))))

        # Where the band's levels run along lines of constant u (or v), the fit gets a knot on each such line.
        u_only, v_only = np.ptp(levels, axis=1).max() < same, np.ptp(levels, axis=0).max() < same
        u_breaks = _crossings(lambda u: level(u, vm), u0, u1, breaks) if u_only else []
        v_breaks = _crossings(lambda v: level(um, v), v0, v1, breaks) if v_only else []
        across = Span(u0, u1, PIECES if u_only or v_only else max(_pieces(levels[:, j], self.field) for j in range(COARSE)), u_breaks, smoothness)
        along = Span(v0, v1, PIECES if u_only or v_only else max(_pieces(levels[i, :], self.field) for i in range(COARSE)), v_breaks, smoothness)
        few_u, few_v = np.linspace(u0, u1, 7)[1:-1] + (u1 - u0) / 97, np.linspace(v0, v1, 7)[1:-1] + (v1 - v0) / 97
        while True:
            points = _surface_points(surface, across.sites, along.sites)
            fitted = SurfaceFit(across, along, self.field(points.reshape(-1, 3)).reshape(points.shape))

            def error(a: np.ndarray, b: np.ndarray) -> float:
                true = self.field(_surface_points(surface, a, b).reshape(-1, 3))
                return float(np.linalg.norm(fitted.at(np.repeat(a, len(b)), np.tile(b, len(a))) - true, axis=1).max())

            more_u = across.count < MOST_PIECES and error(across.between(), few_v) > self.target
            more_v = along.count < MOST_PIECES and error(few_u, along.between()) > self.target
            if not (more_u or more_v):
                return fitted.surface()
            across, along = (across.doubled() if more_u else across), (along.doubled() if more_v else along)

    def _round_surface(self, face: int, fitted, old, bounds):
        """The cylinder, cone, sphere or torus a deformed one still is, set so its (u, v) run the way the old surface's did
        (u starts on the same line, so a seam stays on its edge, and u and v keep their sense)."""
        old = bare(old)
        if not isinstance(old, (Geom_CylindricalSurface, Geom_ConicalSurface, Geom_SphericalSurface, Geom_ToroidalSurface)):
            return None
        if any(BRep_Tool.Degenerated_s(self.body.edges[e]) for e in self.body.face_edges[face]):
            return None  # a face with an edge shrunk to a point (a cone's tip) keeps the fitted surface
        close = max(self.target * 10, 1e-7)
        found = analytic_of(fitted, close)
        u0, u1, v0, v1 = bounds
        if isinstance(old, (Geom_SphericalSurface, Geom_ToroidalSurface)):
            if not isinstance(found, type(old)):
                return None
            us, vs = np.linspace(u0, u1, 5), np.linspace(v0, v1, 5)
            return ball_surface(found, old, self.field, self.field(_surface_points(old, us, vs).reshape(-1, 3)).reshape(5, 5, 3), close)
        if not isinstance(found, (Geom_CylindricalSurface, Geom_ConicalSurface)):
            return None
        low, middle, high = self.field(_surface_points(old, np.array([0.0]), np.array([v0, (v0 + v1) / 2, v1]))[0])
        axis, origin = np.array(_xyz(found.Position().Direction())), np.array(_xyz(found.Position().Location()))
        flipped = (high - low) @ axis < 0
        if flipped:
            axis = -axis
        x = (middle - origin) - ((middle - origin) @ axis) * axis
        if np.linalg.norm(x) < 1e-9:
            return None
        us, vs = np.linspace(u0, u1, 5), np.linspace(v0, v1, 5)
        after = self.field(_surface_points(old, us, vs).reshape(-1, 3)).reshape(5, 5, 3)
        normal = np.cross(after[3, 2] - after[1, 2], after[2, 3] - after[2, 1])
        for mirrored in (False, True):
            position = gp_Ax3(gp_Pnt(*map(float, origin)), gp_Dir(*map(float, axis)), gp_Dir(*map(float, x)))
            if mirrored:
                position.YReverse()
            if isinstance(found, Geom_CylindricalSurface):
                made = Geom_CylindricalSurface(position, found.Radius())
            else:
                made = Geom_ConicalSurface(position, -found.SemiAngle() if flipped else found.SemiAngle(), found.RefRadius())
            u, v = uv_of(made, after[2, 2][None, :])[0]
            point, du, dv = gp_Pnt(), gp_Vec(), gp_Vec()
            made.D1(float(u), float(v), point, du, dv)
            if np.cross(np.array(_xyz(du)), np.array(_xyz(dv))) @ normal > 0:
                return made if off_surface(made, after.reshape(-1, 3)) < close else None
        return None

    # Edges -----------------------------------------------------------------

    def _edge_curve(self, edge: int):
        body, old = self.body, self.body.edges[edge]
        if BRep_Tool.Degenerated_s(old):
            first, last = BRep_Tool.Range_s(old, body.faces[body.edge_faces[edge][0]])
            self.kept_curve.add(edge)
            self.kept_pace.add(edge)
            return None, first, last
        curve = BRep_Tool.Curve_s(old, 0.0, 0.0)
        first, last = BRep_Tool.Range_s(old)
        if edge in self.edge_move:
            trsf = self.edge_move[edge]
            self.kept_pace.add(edge)
            if trsf is None:
                self.kept_curve.add(edge)
            return _moved(curve, trsf), first, last
        loose = all(self.mode[f] != FREE for f in body.edge_faces[edge] if f in self.mode)
        if loose:  # no free-form face needs the old parameters, so a line or circle may stay one
            after = self.field(_curve_points(curve, np.linspace(first, last, SCAN)))
            line, circle = line_of(curve), circle_of(curve)
            if line is not None and on_line(line, after):
                self.kept_curve.add(edge)
                return curve, line_parameter(line, after[0]), line_parameter(line, after[-1])
            if circle is not None and on_circle(circle, after):
                start = circle_parameter(circle, after[0], first)
                self.kept_curve.add(edge)
                return curve, start, circle_parameter(circle, after[-1], start + (last - first))
            if straight(after):
                chord = after[-1] - after[0]
                return Geom_Line(gp_Ax1(gp_Pnt(*map(float, after[0])), gp_Dir(*map(float, chord)))), 0.0, float(np.linalg.norm(chord))

        def level(t: float) -> float:
            return float(self.field.direction @ np.array(_xyz(curve.Value(t))))

        span = Span(first, last, PIECES, _crossings(level, first, last, self.field.falloff.breaks), self.field.falloff.order)
        while True:
            fitted = fit_curve(span, self.field(_curve_points(curve, span.sites)))
            mids = span.between()
            error = float(np.linalg.norm(_curve_points(fitted, mids) - self.field(_curve_points(curve, mids)), axis=1).max())
            if error <= self.target or span.count >= MOST_PIECES:
                self.kept_pace.add(edge)
                return fitted, first, last
            span = span.doubled()

    # Curves on faces -------------------------------------------------------

    def _drawn(self, edge: int, face: int):
        """The edge's curve (two on a seam) in the (u, v) space of the face's new surface."""
        old = old_pcurves(self.body.edges[edge], self.body.faces[face])
        mode = self.mode.get(face)
        if mode is None or old[0] is None:
            return old  # the surface moved rigidly, so the curves drawn on it are the same
        if mode == FREE:  # fitted at the old (u, v), or for a flat face at the old (u, v) turned
            turn = self.turn.get(face)
            return old if turn is None else tuple(one.Rotated(gp_Pnt2d(0.0, 0.0), -turn) if one is not None else None for one in old)
        curve, first, last = self.geometry.curves[edge]
        if curve is None or (mode == SAME and edge in self.kept_curve):
            return old
        surface = self.geometry.surfaces[face]
        if is_plane(surface):
            return GeomAPI.To2d_s(curve, bare(surface).Pln()), None
        old_first = BRep_Tool.Range_s(self.body.edges[edge])[0]
        return tuple(self._drawn_on_round(surface, curve, first, last, one, old_first, edge in self.kept_pace) if one is not None else None for one in old)

    def _drawn_on_round(self, surface, curve, first: float, last: float, old, old_first: float, same_pace: bool):
        span = Span(first, last, DRAWN)
        params = span.sites
        uv = uv_of(surface, _curve_points(curve, params))
        period = np.array(periods(surface))
        start = old.Value(old_first)
        near = np.array([start.X(), start.Y()])
        for k in range(len(uv)):  # u (and on a torus v) repeat: stay next to where the old curve was, then next to the last sample
            for axis in (0, 1):
                if period[axis] > 0:
                    uv[k, axis] += period[axis] * round((near[axis] - uv[k, axis]) / period[axis])
            near = uv[k]
        if same_pace:
            before = np.array([[p.X(), p.Y()] for p in (old.Value(float(t)) for t in params)])
            shift = uv - before
            if np.abs(shift - shift[0]).max() < 1e-9:
                return old if np.abs(shift[0]).max() < 1e-12 else old.Translated(gp_Vec2d(float(shift[0, 0]), float(shift[0, 1])))
        fraction = ((params - first) / (last - first))[:, None]
        if np.abs(uv - (uv[0] + fraction * (uv[-1] - uv[0]))).max() < 1e-9:
            return straight_2d(first, last, uv[0], uv[-1])
        return fit_curve_2d(span, uv)

    # All together ----------------------------------------------------------

    def run(self) -> Outcome:
        body, geometry = self.body, self.geometry
        for number in range(len(body.vertices)):
            point = BRep_Tool.Pnt_s(body.vertices[number])
            if number in self.vertex_move:
                trsf = self.vertex_move[number]
                geometry.points.append(point if trsf is None else point.Transformed(trsf))
            else:
                geometry.points.append(gp_Pnt(*map(float, self.field(body.point(number)[None, :])[0])))
        freeform = 0
        for number in range(len(body.faces)):
            if number in self.face_move:
                geometry.surfaces.append(_moved(self.old_surface[number], self.face_move[number]))
                continue
            self.mode[number], surface = self._rubber_surface(number)
            geometry.surfaces.append(surface)
            if self.mode[number] == FREE and type(bare(self.old_surface[number])).__name__ not in ("Geom_BSplineSurface", "Geom_BezierSurface"):
                freeform += 1
        for number in range(len(body.edges)):
            geometry.curves.append(self._edge_curve(number))
        for face in range(len(body.faces)):
            for edge in body.face_edges[face]:
                geometry.pcurves[(edge, face)] = self._drawn(edge, face)
        geometry.changed_edges = {e for f in self.mode for e in body.face_edges[f]}
        return Outcome(geometry, freeform)

"""Mapping a sketch drawn on the unrolled faces back onto them: sketch regions become faces imprinted on the model."""

import math

from build123d import Face, Location, Wire
from OCP.BRepAlgoAPI import BRepAlgoAPI_Splitter
from OCP.BRepBuilderAPI import BRepBuilderAPI_MakeEdge, BRepBuilderAPI_MakeFace, BRepBuilderAPI_MakeWire
from OCP.BRepLib import BRepLib
from OCP.collections import HArray1_gp_Pnt2d, List_TopoDS_Shape
from OCP.Geom2d import Geom2d_Line, Geom2d_TrimmedCurve
from OCP.Geom2dAPI import Geom2dAPI_Interpolate
from OCP.gp import gp_Dir2d, gp_Pnt2d

from .unwrap_types import Band, CURVE_SAMPLES, UnwrapError
from .sketch import SketchError, regions

from .unwrap_unrolling import build_unrolling


def _pcurve(edge, band: Band, shift: float = 0.0, anchor: float | None = None):
    """The sketch edge as a curve in the band's surface parameter space."""
    kind = edge.geom_type.name if hasattr(edge.geom_type, "name") else str(edge.geom_type)
    count = 1 if kind == "LINE" and band.linear else CURVE_SAMPLES
    uv = []
    for i in range(count + 1):
        p = edge.position_at(i / count)
        uv.append(band.to_param(p.X, p.Y))
    if band.periodic_u:  # keep the angle continuous from one sample to the next
        first = uv[0]
        if anchor is not None:  # start within half a turn of the rest of the outline
            first = (first[0] + band.periodic_u * round((anchor - first[0]) / band.periodic_u), first[1])
        fixed = [first]
        for u, v in uv[1:]:
            fixed.append((u + band.periodic_u * round((fixed[-1][0] - u) / band.periodic_u), v))
        uv = [(u + shift, v) for u, v in fixed]
    if count == 1:
        (ua, va), (ub, vb) = uv
        length = math.hypot(ub - ua, vb - va)
        if length < 1e-12:
            return None
        return Geom2d_TrimmedCurve(Geom2d_Line(gp_Pnt2d(ua, va), gp_Dir2d(ub - ua, vb - va)), 0, length)
    closed = math.hypot(uv[0][0] - uv[-1][0], uv[0][1] - uv[-1][1]) < 1e-9
    points = uv[:-1] if closed else uv  # a whole circle is interpolated as a periodic curve without repeating its start
    samples = HArray1_gp_Pnt2d(1, len(points))
    for i, (u, v) in enumerate(points):
        samples.SetValue(i + 1, gp_Pnt2d(u, v))
    interpolation = Geom2dAPI_Interpolate(samples, closed, 1e-9)
    interpolation.Perform()
    return interpolation.Curve()


def _anchor(wire, band: Band) -> float | None:
    """The angle of the outline's first point, which every edge is kept within half a turn of."""
    if not band.periodic_u:
        return None
    p = wire.edges()[0].position_at(0)
    return band.to_param(p.X, p.Y)[0]


def _wire(wire, band: Band, shift: float = 0.0, anchor: float | None = None):
    maker = BRepBuilderAPI_MakeWire()
    for edge in wire.edges():
        curve = _pcurve(edge, band, shift, anchor)
        if curve is not None:
            maker.Add(BRepBuilderAPI_MakeEdge(curve, band.surface).Edge())
    if not maker.IsDone():
        raise UnwrapError("Could not map the sketch outline onto the surface")
    return maker.Wire()


def _clip(zone: Face, polygon) -> list[Face]:
    """The part of a zone inside a polygon of the unrolled plane."""
    box = Face(Wire.make_polygon([(x, y, 0) for x, y in polygon], close=True))
    try:
        cut = zone.intersect(box)
    except Exception:
        return []
    return [f for f in (cut.faces() if cut is not None else []) if f.area > 1e-9]


def wrap_regions(shape, topology, face_ids, sketch: dict):
    """Imprint the closed regions of a sketch drawn on the unrolled faces onto those faces.
    Returns the new shape and the number of regions."""
    shape, count, _ = wrap_patches(shape, topology, face_ids, sketch)
    return shape, count


def wrap_patches(shape, topology, face_ids, sketch: dict):
    """`wrap_regions` that also returns the mapped faces (the patches as they were made, before the split)."""
    if isinstance(face_ids, int):
        face_ids = [face_ids]
    unrolling = build_unrolling(topology, list(face_ids))
    try:
        zones = regions(sketch)
    except SketchError as e:
        raise UnwrapError(str(e)) from e
    if not zones:
        raise UnwrapError("The sketch has no closed outline to wrap")
    ox, oy, oz = sketch["plane"].get("origin", [0, 0, 0])  # the plane may sit beside the model; zones are made in world space
    if ox or oy or oz:
        zones = [zone.moved(Location((-ox, -oy, -oz))) for zone in zones]
    tools = List_TopoDS_Shape()
    made = 0
    for zone in zones:
        for band in unrolling.bands:
            for k in band.copies:
                for piece in _clip(zone, band.clip(k)):
                    shift = -k * (band.periodic_u or 0.0)
                    anchor = _anchor(piece.outer_wire(), band)
                    maker = BRepBuilderAPI_MakeFace(band.surface, _wire(piece.outer_wire(), band, shift, anchor), True)
                    for inner in piece.inner_wires():
                        maker.Add(_wire(inner, band, shift, anchor).Reversed())
                    if not maker.IsDone():
                        raise UnwrapError("Could not make a face on the surface from this region")
                    mapped = maker.Face()
                    BRepLib.BuildCurves3d_s(mapped, 1e-6)
                    tools.Append(mapped)
                    made += 1
    if not made:
        raise UnwrapError("The sketch has no region on the unrolled faces")
    splitter = BRepAlgoAPI_Splitter()
    arguments = List_TopoDS_Shape()
    arguments.Append(shape)
    splitter.SetArguments(arguments)
    splitter.SetTools(tools)
    splitter.SetNonDestructive(True)
    splitter.Build()
    if not splitter.IsDone() or splitter.Shape().IsNull():
        raise UnwrapError("Could not imprint the sketch on the faces")
    return splitter.Shape(), len(zones), list(tools)

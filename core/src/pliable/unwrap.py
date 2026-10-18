"""Sketching on a cylinder by unwrapping it (spike for S33).

A cylinder unrolls onto a plane without stretching: arc length around the axis becomes the sketch's u, the
position along the axis becomes v. A sketch drawn on that flat strip therefore maps back exactly: every closed
region becomes a face on the cylinder (its outline is the same 2D curves in the surface's parameter space, with
u divided by the radius), which then splits the cylinder face like an ordinary imprint.

Only whole cylinder faces are handled here. Cones unroll the same way (to a circular sector); several faces at
once and curved surfaces that do not unroll (spheres, tori, free-form) are not covered. See docs/agent-notes/sketch.md.
"""

from OCP.BRep import BRep_Tool
from OCP.BRepAdaptor import BRepAdaptor_Surface
from OCP.BRepAlgoAPI import BRepAlgoAPI_Splitter
from OCP.BRepBuilderAPI import BRepBuilderAPI_MakeEdge, BRepBuilderAPI_MakeFace, BRepBuilderAPI_MakeWire
from OCP.BRepLib import BRepLib
from OCP.BRepTools import BRepTools
from OCP.collections import List_TopoDS_Shape
from OCP.Geom2d import Geom2d_Line, Geom2d_TrimmedCurve
from OCP.Geom2dAPI import Geom2dAPI_Interpolate
from OCP.GeomAbs import GeomAbs_Cylinder
from OCP.gp import gp_Dir2d, gp_Pnt2d
from OCP.collections import HArray1_gp_Pnt2d

from .ops import OperationError
from .sketch import STANDARD_PLANES, SketchError, regions

CURVE_SAMPLES = 48


class UnwrapError(OperationError):
    pass


def _cylinder(face_shape):
    """Radius, the middle of the face's angle and height range, and the full range."""
    surface = BRepAdaptor_Surface(face_shape)
    if surface.GetType() != GeomAbs_Cylinder:
        raise UnwrapError("Only cylindrical faces can be unwrapped for now")
    u0, u1, v0, v1 = BRepTools.UVBounds_s(face_shape)
    return surface.Cylinder().Radius(), (u0 + u1) / 2, (v0 + v1) / 2, (u0, u1, v0, v1)


def unwrap_plane() -> dict:
    """The sketch plane the unrolled face is drawn on: the standard XY plane, origin at the face's middle."""
    return STANDARD_PLANES["XY"]


def unwrap_reference(face_shape) -> dict:
    """The face's boundary on the unrolled strip as fixed construction lines (same layout as `face_reference`)."""
    radius, _, _, (u0, u1, v0, v1) = _cylinder(face_shape)
    half_u, half_v = (u1 - u0) / 2 * radius, (v1 - v0) / 2
    corners = [(-half_u, -half_v), (half_u, -half_v), (half_u, half_v), (-half_u, half_v)]
    points = [{"id": i + 1, "u": u, "v": v, "fixed": True} for i, (u, v) in enumerate(corners)]
    entities = [{"id": 1001 + i, "type": "line", "a": i + 1, "b": (i + 1) % 4 + 1, "construction": True, "reference": True} for i in range(4)]
    return {"points": points, "entities": entities}


def _pcurve(edge, radius: float, mid_u: float, mid_v: float):
    """The sketch edge as a curve in the cylinder's (angle, height) parameter space."""

    def uv(t: float) -> gp_Pnt2d:
        p = edge.position_at(t)
        return gp_Pnt2d(mid_u + p.X / radius, mid_v + p.Y)

    a, b = uv(0), uv(1)
    kind = edge.geom_type.name if hasattr(edge.geom_type, "name") else str(edge.geom_type)
    if kind == "LINE":
        length = a.Distance(b)
        if length < 1e-12:
            return None
        return Geom2d_TrimmedCurve(Geom2d_Line(a, gp_Dir2d(b.X() - a.X(), b.Y() - a.Y())), 0, length)
    closed = a.Distance(b) < 1e-9  # a whole circle: interpolate it as a periodic curve without repeating the start
    count = CURVE_SAMPLES if closed else CURVE_SAMPLES + 1
    samples = HArray1_gp_Pnt2d(1, count)
    for i in range(count):
        samples.SetValue(i + 1, uv(i / CURVE_SAMPLES))
    interpolation = Geom2dAPI_Interpolate(samples, closed, 1e-9)
    interpolation.Perform()
    return interpolation.Curve()


def _wire(wire, surface, radius, mid_u, mid_v):
    maker = BRepBuilderAPI_MakeWire()
    for edge in wire.edges():
        curve = _pcurve(edge, radius, mid_u, mid_v)
        if curve is not None:
            maker.Add(BRepBuilderAPI_MakeEdge(curve, surface).Edge())
    if not maker.IsDone():
        raise UnwrapError("Could not map the sketch outline onto the cylinder")
    return maker.Wire()


def wrap_regions(shape, topology, face_id: int, sketch: dict):
    """Imprint the closed regions of a sketch drawn on the unrolled face `face_id` onto that cylinder face.
    Returns the new shape and the number of regions."""
    face_shape = topology.face(face_id)
    radius, mid_u, mid_v, _ = _cylinder(face_shape)
    surface = BRep_Tool.Surface_s(face_shape)
    try:
        zones = regions(sketch)
    except SketchError as e:
        raise UnwrapError(str(e)) from e
    if not zones:
        raise UnwrapError("The sketch has no closed outline to wrap")
    tools = List_TopoDS_Shape()
    for zone in zones:
        maker = BRepBuilderAPI_MakeFace(surface, _wire(zone.outer_wire(), surface, radius, mid_u, mid_v), True)
        for inner in zone.inner_wires():
            maker.Add(_wire(inner, surface, radius, mid_u, mid_v).Reversed())
        if not maker.IsDone():
            raise UnwrapError("Could not make a face on the cylinder from this region")
        mapped = maker.Face()
        BRepLib.BuildCurves3d_s(mapped, 1e-6)
        tools.Append(mapped)
    splitter = BRepAlgoAPI_Splitter()
    arguments = List_TopoDS_Shape()
    arguments.Append(shape)
    splitter.SetArguments(arguments)
    splitter.SetTools(tools)
    splitter.SetNonDestructive(True)
    splitter.Build()
    if not splitter.IsDone() or splitter.Shape().IsNull():
        raise UnwrapError("Could not imprint the sketch on the cylinder")
    return splitter.Shape(), len(zones)

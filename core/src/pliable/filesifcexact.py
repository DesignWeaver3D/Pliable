"""Exact B-rep bodies for .ifc export: one IfcAdvancedBrep per solid, written from the kernel's faces, edges and surfaces.

IfcOpenShell's wheels carry no Python OCC bindings, so the entities are built here from OCP data with the plain IFC
library. Planes, cylinders, spheres and tori (IFC4 has no cone) and lines, circles and ellipses stay analytic; every other surface
or curve becomes a B-spline. `exact_brep` raises when a solid cannot be written (the caller then keeps the faceted body).
"""

from __future__ import annotations

import math

from OCP.BRep import BRep_Tool
from OCP.BRepTools import BRepTools, BRepTools_WireExplorer
from OCP.Geom import (
    Geom_BezierSurface,
    Geom_BSplineCurve,
    Geom_BSplineSurface,
        Geom_Curve,
    Geom_ConicalSurface,
    Geom_CylindricalSurface,
    Geom_Line,
    Geom_Circle,
    Geom_Ellipse,
    Geom_Plane,
    Geom_RectangularTrimmedSurface,
    Geom_SphericalSurface,
    Geom_ToroidalSurface,
    Geom_TrimmedCurve,
)
from OCP.GeomConvert import GeomConvert
from OCP.TopAbs import TopAbs_FACE, TopAbs_FORWARD, TopAbs_REVERSED, TopAbs_SHELL, TopAbs_WIRE
from OCP.TopExp import TopExp, TopExp_Explorer
from OCP.TopoDS import TopoDS, TopoDS_Iterator, TopoDS_Shape


class _Writer:
    """Builds the IFC entities for one solid, sharing points, directions, vertices and edges between faces."""

    def __init__(self, model):
        self.m = model
        self.points: dict = {}
        self.directions: dict = {}
        self.edges: dict = {}
        self.vertices: dict = {}

    def point(self, p):
        key = (round(p.X(), 9), round(p.Y(), 9), round(p.Z(), 9))
        if key not in self.points:
            self.points[key] = self.m.createIfcCartesianPoint((p.X(), p.Y(), p.Z()))
        return self.points[key]

    def direction(self, d):
        key = (round(d.X(), 12), round(d.Y(), 12), round(d.Z(), 12))
        if key not in self.directions:
            self.directions[key] = self.m.createIfcDirection((d.X(), d.Y(), d.Z()))
        return self.directions[key]

    def placement(self, ax):
        return self.m.createIfcAxis2Placement3D(self.point(ax.Location()), self.direction(ax.Direction()), self.direction(ax.XDirection()))

    def vertex(self, v):
        for known, entity in self.vertices.items():
            if known.IsSame(v):
                return entity
        entity = self.m.createIfcVertexPoint(self.point(BRep_Tool.Pnt_s(v)))
        self.vertices[v] = entity
        return entity

    # curves

    def bspline_curve(self, curve):
        curve = curve.Copy() if hasattr(curve, "Copy") else curve
        if curve.IsPeriodic():  # cut it open at its own period so the knot vector ends are clamped
            curve.Segment(curve.FirstParameter(), curve.LastParameter())
        n = curve.NbPoles()
        poles = [self.point(curve.Pole(i + 1)) for i in range(n)]
        mults = [curve.Multiplicity(i + 1) for i in range(curve.NbKnots())]
        knots = [curve.Knot(i + 1) for i in range(curve.NbKnots())]
        args = (curve.Degree(), poles, "UNSPECIFIED", curve.IsClosed(), False, mults, knots, "UNSPECIFIED")
        weights = [curve.Weight(i + 1) for i in range(n)]
        if any(abs(w - 1.0) > 1e-12 for w in weights):  # the kernel's IsRational flag is not reliable after conversions
            return self.m.createIfcRationalBSplineCurveWithKnots(*args, weights)
        return self.m.createIfcBSplineCurveWithKnots(*args)

    def curve(self, curve: Geom_Curve, first: float, last: float):
        while isinstance(curve, Geom_TrimmedCurve):
            curve = curve.BasisCurve()
        if isinstance(curve, Geom_Line):
            line = curve.Lin()
            vector = self.m.createIfcVector(self.direction(line.Direction()), 1.0)
            return self.m.createIfcLine(self.point(line.Location()), vector)
        if isinstance(curve, Geom_Circle):
            c = curve.Circ()
            return self.m.createIfcCircle(self.placement(c.Position()), c.Radius())
        if isinstance(curve, Geom_Ellipse):
            e = curve.Elips()
            return self.m.createIfcEllipse(self.placement(e.Position()), e.MajorRadius(), e.MinorRadius())
        if isinstance(curve, Geom_BSplineCurve):
            return self.bspline_curve(curve)
        converted = GeomConvert.CurveToBSplineCurve_s(Geom_TrimmedCurve(curve, first, last))
        return self.bspline_curve(converted)

    def edge(self, edge):
        for known, entity in self.edges.items():
            if known.IsSame(edge):
                return entity
        forward = TopoDS.Edge(edge.Oriented(TopAbs_FORWARD))
        first, last = BRep_Tool.Range_s(forward)
        curve = BRep_Tool.Curve_s(forward, first, last)
        if curve is None:
            raise ValueError("edge without a 3D curve")
        start = self.vertex(TopExp.FirstVertex_s(forward, False))
        end = self.vertex(TopExp.LastVertex_s(forward, False))
        entity = self.m.createIfcEdgeCurve(start, end, self.curve(curve, first, last), True)
        self.edges[forward] = entity
        return entity

    # surfaces

    def bspline_surface(self, surface):
        surface = surface.Copy() if hasattr(surface, "Copy") else surface
        if surface.IsUPeriodic() or surface.IsVPeriodic():  # cut it open at its own period so the knot vector ends are clamped
            u1, u2, v1, v2 = surface.Bounds()
            surface.Segment(u1, u2, v1, v2)
        nu, nv = surface.NbUPoles(), surface.NbVPoles()
        poles = [[self.point(surface.Pole(i + 1, j + 1)) for j in range(nv)] for i in range(nu)]
        umults = [surface.UMultiplicity(i + 1) for i in range(surface.NbUKnots())]
        vmults = [surface.VMultiplicity(i + 1) for i in range(surface.NbVKnots())]
        uknots = [surface.UKnot(i + 1) for i in range(surface.NbUKnots())]
        vknots = [surface.VKnot(i + 1) for i in range(surface.NbVKnots())]
        args = (surface.UDegree(), surface.VDegree(), poles, "UNSPECIFIED", surface.IsUClosed(), surface.IsVClosed(), False, umults, vmults, uknots, vknots, "UNSPECIFIED")
        weights = [[surface.Weight(i + 1, j + 1) for j in range(nv)] for i in range(nu)]
        if any(abs(w - 1.0) > 1e-12 for row in weights for w in row):
            return self.m.createIfcRationalBSplineSurfaceWithKnots(*args, weights)
        return self.m.createIfcBSplineSurfaceWithKnots(*args)

    def surface(self, face):
        surface = BRep_Tool.Surface_s(face)
        while isinstance(surface, Geom_RectangularTrimmedSurface):
            surface = surface.BasisSurface()
        if isinstance(surface, Geom_Plane):
            return self.m.createIfcPlane(self.axis3(surface.Position()))
        analytic = None
        if isinstance(surface, Geom_CylindricalSurface):
            analytic = (self.m.createIfcCylindricalSurface, surface.Position(), (surface.Radius(),))
        elif isinstance(surface, Geom_ConicalSurface) and surface.Position().Direct():
            return self.cone(surface, BRepTools.UVBounds_s(face)[2:])
        elif isinstance(surface, Geom_SphericalSurface):
            analytic = (self.m.createIfcSphericalSurface, surface.Position(), (surface.Radius(),))
        elif isinstance(surface, Geom_ToroidalSurface):
            analytic = (self.m.createIfcToroidalSurface, surface.Position(), (surface.MajorRadius(), surface.MinorRadius()))
        if analytic is not None and surface.Position().Direct():
            make, position, values = analytic
            return make(self.axis3(position), *values)
        if isinstance(surface, (Geom_BSplineSurface,)):
            return self.bspline_surface(surface)
        u1, u2, v1, v2 = BRepTools.UVBounds_s(face)
        trimmed = Geom_RectangularTrimmedSurface(surface, u1, u2, v1, v2) if not isinstance(surface, Geom_BezierSurface) else surface
        return self.bspline_surface(GeomConvert.SurfaceToBSplineSurface_s(trimmed))

    def cone(self, surface, v_range):
        """IFC4 has no cone: write it as a rational B-spline (quarter-circle arcs by the generating line), exact."""
        position, angle, radius = surface.Position(), surface.SemiAngle(), surface.RefRadius()
        origin, z, x = position.Location(), position.Direction(), position.XDirection()
        y = z.Crossed(x)
        v1, v2 = v_range
        rings = []
        for v in (v1, v2):
            r, h = radius + v * math.sin(angle), v * math.cos(angle)
            ring = []
            for k in range(9):  # corners (weight sqrt(1/2)) and arc ends (weight 1) of the quarter-circle arcs
                theta = k * math.pi / 4
                reach = r if k % 2 == 0 else r * math.sqrt(2.0)
                dx, dy = math.cos(theta) * reach, math.sin(theta) * reach
                ring.append(self.m.createIfcCartesianPoint((origin.X() + x.X() * dx + y.X() * dy + z.X() * h, origin.Y() + x.Y() * dx + y.Y() * dy + z.Y() * h, origin.Z() + x.Z() * dx + y.Z() * dy + z.Z() * h)))
            rings.append(ring)
        poles = [[rings[0][k], rings[1][k]] for k in range(9)]
        weights = [[1.0 if k % 2 == 0 else math.sqrt(0.5)] * 2 for k in range(9)]
        return self.m.createIfcRationalBSplineSurfaceWithKnots(2, 1, poles, "UNSPECIFIED", True, False, False, [3, 2, 2, 2, 3], [2, 2], [0.0, math.pi / 2, math.pi, 3 * math.pi / 2, 2 * math.pi], [v1, v2], "UNSPECIFIED", weights)

    def axis3(self, ax3):
        return self.m.createIfcAxis2Placement3D(self.point(ax3.Location()), self.direction(ax3.Direction()), self.direction(ax3.XDirection()))

    # faces

    def loop(self, wire, flip: bool):
        oriented = []
        explorer = BRepTools_WireExplorer(wire)
        while explorer.More():
            edge = explorer.Current()
            if BRep_Tool.Degenerated_s(edge):
                raise ValueError("face with a degenerate edge (a pole)")  # the IFC reader cannot rebuild such a loop; the faceted body is used
            oriented.append((edge, edge.Orientation() == TopAbs_FORWARD))
            explorer.Next()
        if flip:
            oriented = [(edge, not same) for edge, same in reversed(oriented)]
        if not oriented:
            raise ValueError("empty loop")
        return self.m.createIfcEdgeLoop([self.m.createIfcOrientedEdge(None, None, self.edge(edge), same) for edge, same in oriented])

    def face(self, face):
        reversed_face = face.Orientation() == TopAbs_REVERSED
        outer = BRepTools.OuterWire_s(face)
        wires = []
        it = TopoDS_Iterator(face, False)
        while it.More():
            if it.Value().ShapeType() == TopAbs_WIRE:
                wires.append(TopoDS.Wire(it.Value()))
            it.Next()
        bounds = []
        for wire in wires:
            loop = self.loop(wire, reversed_face)
            maker = self.m.createIfcFaceOuterBound if wire.IsSame(outer) else self.m.createIfcFaceBound
            bounds.append(maker(loop, True))
        return self.m.createIfcAdvancedFace(bounds, self.surface(face), not reversed_face)

    def solid_brep(self, solid: TopoDS_Shape):
        shells = TopExp_Explorer(solid, TopAbs_SHELL)
        shell = shells.Current()
        shells.Next()
        if shells.More():
            raise ValueError("solid with more than one shell")
        faces = []
        explorer = TopExp_Explorer(shell, TopAbs_FACE)
        while explorer.More():
            faces.append(self.face(TopoDS.Face(explorer.Current())))
            explorer.Next()
        return self.m.createIfcAdvancedBrep(self.m.createIfcClosedShell(faces))


def exact_brep(model, solid: TopoDS_Shape):
    """An IfcAdvancedBrep for one solid; raises ValueError (or another error) when it cannot be written."""
    import ifcopenshell

    _Writer(ifcopenshell.file(schema="IFC4")).solid_brep(solid)  # dry run, so a failure leaves nothing behind in `model`
    return _Writer(model).solid_brep(solid)

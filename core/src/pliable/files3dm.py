"""3dm (openNURBS) import and export through the rhino3dm wheels.

Import turns every boundary representation in the file into kernel faces (NURBS surface trimmed by its 3D edges), sews them and
makes solids where the shells close; loose meshes are skipped. Export writes each body as a triangle mesh, because the wheels
cannot build trimmed boundary representations; it is as lossy as an STL file."""

from __future__ import annotations

import os
import tempfile

from OCP.BRep import BRep_Builder
from OCP.BRepBuilderAPI import BRepBuilderAPI_MakeEdge, BRepBuilderAPI_MakeFace, BRepBuilderAPI_MakeWire, BRepBuilderAPI_Sewing
from OCP.Geom import Geom_BSplineCurve, Geom_BSplineSurface
from OCP.ShapeFix import ShapeFix_Face, ShapeFix_Shape
from OCP.collections import Array1_double as TColStd_Array1OfReal, Array1_gp_Pnt as TColgp_Array1OfPnt, Array1_int as TColStd_Array1OfInteger, Array2_double as TColStd_Array2OfReal, Array2_gp_Pnt as TColgp_Array2OfPnt
from OCP.TopAbs import TopAbs_FACE
from OCP.TopoDS import TopoDS, TopoDS_Compound, TopoDS_Shape, TopoDS_Shell
from build123d import Shape

TOLERANCE = 1e-3  # model units (mm): gaps up to this size between converted faces are stitched shut


def _import_rhino():
    try:
        import rhino3dm
    except ImportError as e:  # the wheel is a normal dependency; this only guards a broken install
        raise ValueError("Reading .3dm files needs the rhino3dm package") from e
    return rhino3dm


def _knots(values) -> tuple[list[float], list[int]]:
    """OCC (distinct knots, multiplicities) from the file's knot list, which omits the first and last knot of the usual vector."""
    full = [values[0], *values, values[-1]]
    distinct, mults = [], []
    for k in full:
        if distinct and abs(k - distinct[-1]) < 1e-12:
            mults[-1] += 1
        else:
            distinct.append(k)
            mults.append(1)
    return distinct, mults


def _arrays(distinct, mults):
    knots, multiplicities = TColStd_Array1OfReal(1, len(distinct)), TColStd_Array1OfInteger(1, len(mults))
    for i, (k, m) in enumerate(zip(distinct, mults), 1):
        knots.SetValue(i, k)
        multiplicities.SetValue(i, m)
    return knots, multiplicities


def _euclid(p):
    w = p.W if p.W else 1.0
    return p.X / w, p.Y / w, p.Z / w, w


def _surface(nurbs):
    from OCP.gp import gp_Pnt

    nu, nv = nurbs.Points.CountU, nurbs.Points.CountV
    poles, weights = TColgp_Array2OfPnt(1, nu, 1, nv), TColStd_Array2OfReal(1, nu, 1, nv)
    for i in range(nu):
        for j in range(nv):
            x, y, z, w = _euclid(nurbs.Points[i, j])
            poles.SetValue(i + 1, j + 1, gp_Pnt(x, y, z))
            weights.SetValue(i + 1, j + 1, w)
    ku, mu = _arrays(*_knots(list(nurbs.KnotsU)))
    kv, mv = _arrays(*_knots(list(nurbs.KnotsV)))
    return Geom_BSplineSurface(poles, weights, ku, kv, mu, mv, nurbs.OrderU - 1, nurbs.OrderV - 1)


def _curve(nurbs):
    from OCP.gp import gp_Pnt

    n = len(nurbs.Points)
    poles, weights = TColgp_Array1OfPnt(1, n), TColStd_Array1OfReal(1, n)
    for i in range(n):
        x, y, z, w = _euclid(nurbs.Points[i])
        poles.SetValue(i + 1, gp_Pnt(x, y, z))
        weights.SetValue(i + 1, w)
    knots, mults = _arrays(*_knots(list(nurbs.Knots)))
    return Geom_BSplineCurve(poles, weights, knots, mults, nurbs.Order - 1)


def _is_whole_patch(face) -> bool:
    """True for a face that is its whole surface patch with seams or poles (a full sphere, cone tip or torus): one loop whose
    trims are all degenerate or seams, which are used twice."""
    loops = list(face.Loops)
    if len(loops) != 1:
        return False
    ids = [t.EdgeIndex for t in loops[0].Trims]
    if all(i >= 0 and ids.count(i) == 1 for i in ids):
        return False
    return all(i < 0 or ids.count(i) == 2 for i in ids)


def _brep_shape(brep) -> TopoDS_Shape | None:
    """One 3dm brep as a kernel shape (a solid when its faces close), or None when nothing could be converted."""
    edges = {}
    for index in range(len(brep.Edges)):
        try:
            edges[index] = BRepBuilderAPI_MakeEdge(_curve(brep.Edges[index].ToNurbsCurve())).Edge()
        except Exception:  # an edge the kernel cannot build; its faces are healed or dropped
            continue
    sewing = BRepBuilderAPI_Sewing(TOLERANCE)
    added = 0
    for face in brep.Faces:
        try:
            surface = _surface(face.ToNurbsSurface())
            if _is_whole_patch(face):
                result = BRepBuilderAPI_MakeFace(surface, 1e-6).Face()  # natural bounds carry the seam and pole edges
                sewing.Add(result.Reversed() if face.OrientationIsReversed else result)
                added += 1
                continue
            wires = []
            for loop in face.Loops:
                maker = BRepBuilderAPI_MakeWire()
                for trim in loop.Trims:
                    edge = edges.get(trim.EdgeIndex)
                    if edge is None:  # a degenerate trim (a surface pole); the repair below restores it
                        continue
                    maker.Add(TopoDS.Edge(edge.Reversed() if trim.IsReversed else edge))
                if maker.IsDone():
                    wires.append(maker.Wire())
            outer = wires[0]
            made = BRepBuilderAPI_MakeFace(surface, outer, True)
            for inner in wires[1:]:
                made.Add(inner)
            fixer = ShapeFix_Face(made.Face())
            fixer.FixOrientation()
            fixer.Perform()
            result = fixer.Face()
            sewing.Add(result.Reversed() if face.OrientationIsReversed else result)
            added += 1
        except Exception:  # one face that fails to convert leaves a gap that the import warnings report
            continue
    if not added:
        return None
    sewing.Perform()
    sewn = sewing.SewedShape()
    if sewn.ShapeType() == TopAbs_FACE:  # a lone face (a whole sphere) still goes through the shell repair
        builder, shell = BRep_Builder(), TopoDS_Shell()
        builder.MakeShell(shell)
        builder.Add(shell, sewn)
        sewn = shell
    fixer = ShapeFix_Shape(sewn)
    fixer.Perform()
    return fixer.Shape()


def read_3dm(data: bytes) -> Shape:
    """The boundary representations of a .3dm file as one kernel shape."""
    rhino3dm = _import_rhino()
    model = rhino3dm.File3dm.FromByteArray(data)
    if model is None:
        raise ValueError("Could not read that 3dm file")
    builder, compound = BRep_Builder(), TopoDS_Compound()
    builder.MakeCompound(compound)
    count = 0
    for obj in model.Objects:
        geometry = obj.Geometry
        if isinstance(geometry, rhino3dm.Extrusion):
            geometry = geometry.ToBrep(True)
        if not isinstance(geometry, rhino3dm.Brep):
            continue
        shape = _brep_shape(geometry)
        if shape is not None and not shape.IsNull():
            builder.Add(compound, shape)
            count += 1
    if not count:
        raise ValueError("That 3dm file has no surfaces or solids to import (meshes and curves are not read)")
    return Shape.cast(compound)


def write_3dm(shape: TopoDS_Shape, linear: float = 0.01, angular: float = 0.3) -> bytes:
    """The model as a 3dm file holding one triangle mesh per solid."""
    rhino3dm = _import_rhino()
    model = rhino3dm.File3dm()
    model.Settings.ModelUnitSystem = rhino3dm.UnitSystem.Millimeters
    solids = Shape.cast(shape).solids() or [Shape.cast(shape)]
    for solid in solids:
        vertices, triangles = solid.tessellate(linear, angular)
        mesh = rhino3dm.Mesh()
        for v in vertices:
            mesh.Vertices.Add(v.X, v.Y, v.Z)
        for a, b, c in triangles:
            mesh.Faces.AddFace(a, b, c)
        mesh.Normals.ComputeNormals()
        mesh.Compact()
        model.Objects.AddMesh(mesh)
    with tempfile.TemporaryDirectory() as tmp:
        path = os.path.join(tmp, "export.3dm")
        if not model.Write(path, 7):
            raise ValueError("Could not write that model as 3dm")
        with open(path, "rb") as f:
            return f.read()

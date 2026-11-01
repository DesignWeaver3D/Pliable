"""Face and edge geometry for the model operations: face normals, pull directions, edge curves and handle points."""

from OCP.BRep import BRep_Tool
from OCP.BRepAdaptor import BRepAdaptor_Surface
from OCP.BRepLProp import BRepLProp_SLProps
from OCP.GeomAbs import GeomAbs_Plane
from OCP.gp import gp_Dir, gp_Pnt, gp_Vec
from OCP.TopAbs import TopAbs_REVERSED
from OCP.TopoDS import TopoDS_Edge, TopoDS_Face

from .opserrors import OperationError


def planar_normal(face: TopoDS_Face) -> gp_Dir | None:
    """Outward normal of a planar face, or None if the face isn't planar."""
    surface = BRepAdaptor_Surface(face)
    if surface.GetType() != GeomAbs_Plane:
        return None
    normal = surface.Plane().Axis().Direction()
    if face.Orientation() == TopAbs_REVERSED:
        normal = normal.Reversed()
    return normal


MIN_PULL_COSINE = 0.05  # a pull direction within about 3 degrees of a face's own plane would make a sliver, not an extrusion


def pull_direction(normal: gp_Dir, direction=None) -> gp_Vec:
    """The unit direction a face is pushed or pulled along: its normal, or the chosen `direction` (x, y, z) turned to point
    out of the face (a picked edge has no sign of its own). A direction along the face itself is refused."""
    if direction is None:
        return gp_Vec(normal)
    vector = gp_Vec(*direction)
    if vector.Magnitude() < 1e-9:
        return gp_Vec(normal)
    vector.Normalize()
    cosine = vector.Dot(gp_Vec(normal))
    if abs(cosine) < MIN_PULL_COSINE:
        raise OperationError("That direction lies along the face; pick one that points out of it")
    return vector if cosine > 0 else vector.Reversed()


def edge_curve(edge: TopoDS_Edge):
    """(point_at, tangent_at, length) helpers for an edge: `point_at(u)` and `tangent_at(u)` take u from 0 (the edge's
    first end) to 1 (its last) and give xyz tuples (the tangent is a unit vector); length is the arc length."""
    from OCP.BRepAdaptor import BRepAdaptor_Curve
    from OCP.BRepGProp import BRepGProp
    from OCP.GProp import GProp_GProps

    curve = BRepAdaptor_Curve(edge)
    first, last = curve.FirstParameter(), curve.LastParameter()

    def point_at(u: float):
        p = curve.Value(first + (last - first) * u)
        return (p.X(), p.Y(), p.Z())

    def tangent_at(u: float):
        p, v = gp_Pnt(), gp_Vec()
        curve.D1(first + (last - first) * u, p, v)
        m = v.Magnitude() or 1.0
        return (v.X() / m, v.Y() / m, v.Z() / m)

    props = GProp_GProps()
    BRepGProp.LinearProperties_s(edge, props)
    return point_at, tangent_at, props.Mass()


def face_handle_point(face: TopoDS_Face) -> gp_Pnt:
    """A point on a planar face to hang an on-screen handle on: the center of mass when it lies on the face, else the
    middle of the face's longest boundary edge (an L-shaped or ring-shaped face has its center of mass off the face)."""
    from OCP.BRepClass import BRepClass_FaceClassifier
    from OCP.BRepGProp import BRepGProp
    from OCP.GProp import GProp_GProps
    from OCP.TopAbs import TopAbs_IN
    from OCP.TopExp import TopExp_Explorer
    from OCP.TopAbs import TopAbs_EDGE
    from OCP.TopoDS import TopoDS

    props = GProp_GProps()
    BRepGProp.SurfaceProperties_s(face, props)
    centre = props.CentreOfMass()
    if BRepClass_FaceClassifier(face, centre, 1e-6).State() == TopAbs_IN:
        return centre
    best, best_length = centre, -1.0
    explorer = TopExp_Explorer(face, TopAbs_EDGE)
    while explorer.More():
        edge_props = GProp_GProps()
        BRepGProp.LinearProperties_s(explorer.Current(), edge_props)
        if edge_props.Mass() > best_length:
            best, best_length = edge_props.CentreOfMass(), edge_props.Mass()
        explorer.Next()
    return best


def face_normal_at_edge(face: TopoDS_Face, edge: TopoDS_Edge) -> gp_Dir | None:
    """Outward normal of `face` at the middle of `edge` (which must lie on it)."""
    curve2d = BRep_Tool.CurveOnSurface_s(edge, face, 0.0, 1.0)
    if curve2d is None:
        return None
    first, last = BRep_Tool.Range_s(edge, face)
    uv = curve2d.Value((first + last) / 2)
    props = BRepLProp_SLProps(BRepAdaptor_Surface(face), uv.X(), uv.Y(), 1, 1e-6)
    if not props.IsNormalDefined():
        return None
    normal = props.Normal()
    return normal.Reversed() if face.Orientation() == TopAbs_REVERSED else normal


def edge_outward_normal(topology, edge: TopoDS_Edge) -> list[float] | None:
    """Unit direction pointing away from the material at an edge: the bisector
    of the adjacent faces' outward normals. This is the axis along which
    dragging the edge outward makes a fillet and inward makes a chamfer."""
    total = gp_Vec(0, 0, 0)
    for face in topology.edge_faces(edge):
        normal = face_normal_at_edge(face, edge)
        if normal is not None:
            total.Add(gp_Vec(normal))
    if total.Magnitude() < 1e-6:
        return None
    total.Normalize()
    return [total.X(), total.Y(), total.Z()]

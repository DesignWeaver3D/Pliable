"""The Resize chamfer tool."""

from OCP.BRepAdaptor import BRepAdaptor_Surface
from OCP.BRepGProp import BRepGProp
from OCP.GProp import GProp_GProps
from OCP.gp import gp_Vec

from ..ops import MIN_DISTANCE, OperationError, edge_curve, planar_normal
from ..shared.faces import _face_edges, _rebuild_round
from ..tools import Accepts, Handle, Param, register, Tool


def _sides(topology, face) -> list[tuple]:
    """The chamfer face's two long edges, each with the face on its other side: [(edge, neighbor face), ...]."""
    edges = list(_face_edges(face))
    if len(edges) != 4:
        raise OperationError("That face is not a simple chamfer (it should have four edges)")

    def length(edge) -> float:
        props = GProp_GProps()
        BRepGProp.LinearProperties_s(edge, props)
        return props.Mass()

    sides = []
    for edge in sorted(edges, key=length, reverse=True)[:2]:
        others = [f for f in topology.edge_faces(edge) if not f.IsSame(face)]
        if len(others) != 1:
            raise OperationError("That face is not a simple chamfer")
        sides.append((edge, others[0]))
    return sides


@register
class ResizeChamfer(Tool):
    """Change the size of a chamfer from the chamfer face: it is removed and the sharp edge chamfered again with
    two distances, `first` along the first neighbor face and `second` along the other (both 0 leaves the sharp
    edge). Each distance has its own handle."""

    id = "resize_chamfer"
    label = "Resize chamfer"
    description = "Changes the size of an existing chamfer, each distance on its own. Select the chamfer face."
    accepts = Accepts(faces=(1, 1))
    params = [Param("first", "length", 2), Param("second", "length", 2)]

    def applies(self, topology, selection):
        return planar_normal(topology.face(selection.faces[0])) is not None

    def handles(self, topology, selection, values):
        """One handle per leg, on the neighbor face it is measured along, sliding away from the sharp edge the chamfer cut off."""
        (edge_a, face_a), (edge_b, face_b) = _sides(topology, topology.face(selection.faces[0]))
        planes = [BRepAdaptor_Surface(f) for f in (face_a, face_b)]
        if any(p.GetType().name != "GeomAbs_Plane" for p in planes):
            return []
        normals, offsets = [], []
        for p in planes:
            plane = p.Plane()
            n = plane.Axis().Direction()
            loc = plane.Location()
            normals.append(gp_Vec(n.X(), n.Y(), n.Z()))
            offsets.append(gp_Vec(loc.X(), loc.Y(), loc.Z()).Dot(gp_Vec(n.X(), n.Y(), n.Z())))
        along = normals[0].Crossed(normals[1])  # the sharp edge's direction (where the two neighbor planes meet)
        square = along.SquareMagnitude()
        if square < 1e-12:
            return []
        on_line = normals[1].Crossed(along).Multiplied(offsets[0]).Added(normals[0].Crossed(along).Multiplied(-offsets[1]))  # (h1 n2 x d - h2 n1 x d) / |d|^2
        on_line.Divide(square)
        along.Normalize()
        handles = []
        for param, label, edge, value in (("first", "First distance", edge_a, values["first"]), ("second", "Second distance", edge_b, values["second"])):
            mid = gp_Vec(*edge_curve(edge)[0](0.5))
            foot = on_line.Added(along.Multiplied(mid.Subtracted(on_line).Dot(along)))  # the sharp edge's point nearest the long edge's middle
            leg = mid.Subtracted(foot)
            if leg.Magnitude() < 1e-9:
                return []
            leg.Normalize()
            point = foot.Added(leg.Multiplied(value))
            handles.append(Handle(param, label, (point.X(), point.Y(), point.Z()), (leg.X(), leg.Y(), leg.Z()), min=MIN_DISTANCE))
        return handles

    def run(self, topology, selection, values, preview):
        face = topology.face(selection.faces[0])
        sides = _sides(topology, face)
        return _rebuild_round(topology, face, [n for _, n in sides], values["first"], chamfer=True, second_size=values["second"])

"""The Extrude edge tool: model edges swept along a direction into a new surface body."""

from OCP.BRep import BRep_Builder
from OCP.BRepAdaptor import BRepAdaptor_Curve
from OCP.BRepBuilderAPI import BRepBuilderAPI_Copy, BRepBuilderAPI_Sewing
from OCP.BRepPrimAPI import BRepPrimAPI_MakePrism
from OCP.TopoDS import TopoDS, TopoDS_Compound, TopoDS_Shell
from OCP.gp import gp_Vec

from ..ops import is_surface, MIN_DISTANCE, OperationError, OpResult, solids_of
from ..tools import Accepts, Param, register, Tool


def _ends(edge):
    curve = BRepAdaptor_Curve(edge)
    return curve.Value(curve.FirstParameter()), curve.Value(curve.LastParameter())


@register
class ExtrudeEdge(Tool):
    """Sweep the selected edges (straight or curved) by `distance` along the direction (dx, dy, dz) into one open surface body
    added beside the model; the edges stay as they are. Edges that join end to end give one connected surface."""

    id = "extrude_edge"
    label = "Extrude edge"
    description = "Extrudes the selected edges along a direction into a new surface body. Select one or more edges, then give the direction and the distance."
    accepts = Accepts(edges=(1, None))
    reference_edges = True  # the edges are only read: the body they belong to is not changed
    body_kind = "Surface"
    params = [
        Param("distance", "length", 10),
        Param("dx", "number", 0),
        Param("dy", "number", 0),
        Param("dz", "number", 1),
    ]

    def run(self, topology, selection, values, preview):
        direction = gp_Vec(values["dx"], values["dy"], values["dz"])
        if direction.Magnitude() < 1e-9:
            raise OperationError("Give a direction that is not zero")
        if abs(values["distance"]) < MIN_DISTANCE:
            raise OperationError("The distance must not be zero")
        direction.Normalize()
        vector = direction.Multiplied(values["distance"])
        faces = []
        for edge_id in selection.edges:
            edge = TopoDS.Edge(BRepBuilderAPI_Copy(topology.edge(edge_id), True, False).Shape())
            a, b = _ends(edge)
            chord = gp_Vec(a, b)
            if chord.Magnitude() > 1e-9 and chord.CrossMagnitude(direction) < 1e-9:
                raise OperationError("The direction runs along a straight edge, which would sweep no surface; pick another direction")
            face = BRepPrimAPI_MakePrism(edge, vector).Shape()
            faces.append(face)
        sewing = BRepBuilderAPI_Sewing(1e-4)
        for face in faces:
            sewing.Add(face)
        sewing.Perform()
        shells = [b for b in solids_of(sewing.SewedShape()) if is_surface(b)]
        if not shells:  # sewing leaves a lone face as a face: hold it in a shell of its own
            shell, builder = TopoDS_Shell(), BRep_Builder()
            builder.MakeShell(shell)
            builder.Add(shell, sewing.SewedShape())
            shells = [shell]
        compound, builder = TopoDS_Compound(), BRep_Builder()
        builder.MakeCompound(compound)
        for body in solids_of(topology.shape):
            builder.Add(compound, body)
        for shell in shells:
            builder.Add(compound, shell)
        return OpResult(compound, [], unified=True)

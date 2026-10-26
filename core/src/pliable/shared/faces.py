"""Planar-face tool base, plane frames and rounding rebuilds shared by the face tools."""

from OCP.BRepAdaptor import BRepAdaptor_Surface
from OCP.BRepAlgoAPI import BRepAlgoAPI_Defeaturing
from OCP.BRepCheck import BRepCheck_Analyzer
from OCP.BRepGProp import BRepGProp
from OCP.GProp import GProp_GProps
from OCP.gp import gp_Dir, gp_Pnt

from ..ops import MIN_DISTANCE, OperationError, OpResult, planar_normal
from ..tools import Tool
from .solids import finish


def _plane_axes(face) -> tuple[gp_Pnt, gp_Dir, gp_Dir, gp_Dir]:
    """Centre of a planar face, its outward normal and two in-plane directions."""
    normal = planar_normal(face)
    if normal is None:
        raise OperationError("Select a flat face")
    props = GProp_GProps()
    BRepGProp.SurfaceProperties_s(face, props)
    plane = BRepAdaptor_Surface(face).Plane()
    return props.CentreOfMass(), normal, plane.XAxis().Direction(), plane.YAxis().Direction()


class _PlanarFace(Tool):
    def applies(self, topology, selection):
        return all(planar_normal(topology.face(i)) is not None for i in selection.faces)


def _chamfer_with_face(topology, selection, add, per_edge_face: bool = False) -> OpResult:
    """Chamfer the selected edges, measuring from the selected face, which every edge must border. With `per_edge_face` an edge
    that does not border it is measured from its own first neighbouring face instead."""
    from OCP.BRepFilletAPI import BRepFilletAPI_MakeChamfer

    face = topology.face(selection.faces[0])
    maker = BRepFilletAPI_MakeChamfer(topology.shape)
    edges = [topology.edge(i) for i in selection.edges]
    for edge in edges:
        beside = topology.edge_faces(edge)
        if any(f.IsSame(face) for f in beside):
            add(maker, edge, face)
        elif per_edge_face and beside:
            add(maker, edge, beside[0])
        else:
            raise OperationError("Every edge must border the selected reference face")
    try:
        maker.Build()
    except Exception as e:  # OCCT raises Standard_Failure for impossible sizes
        raise OperationError(f"Could not chamfer: {e}") from None
    if not maker.IsDone() or maker.Shape().IsNull() or not BRepCheck_Analyzer(maker.Shape()).IsValid():
        raise OperationError("Could not chamfer these edges at this size")
    generated = [g for edge in edges for g in maker.Generated(edge)]
    return OpResult(maker.Shape(), generated)


def _rebuild_round(topology, face, neighbours: list, size: float, chamfer: bool, end_size: float = 0.0, second_size: float | None = None) -> OpResult:
    """Remove a fillet or chamfer face (its two neighbours extend back to a sharp edge), then round that edge
    again with `size` (a fillet radius or chamfer leg); size 0 leaves the sharp edge. A fillet with `end_size`
    above 0 is variable: `size` at the edge's first vertex growing or shrinking to `end_size` at its last.
    A chamfer with `second_size` has two legs: `size` along the first neighbour face and `second_size` along the second."""
    from ..ops import _follow, fillet_chamfer
    from ..topology import Topology

    operation = BRepAlgoAPI_Defeaturing()
    operation.SetShape(topology.shape)
    operation.AddFaceToRemove(face)
    operation.SetRunParallel(True)
    operation.Build()
    if not operation.IsDone() or operation.Shape().IsNull():
        raise OperationError("Could not remove this round to resize it")
    sharp = operation.Shape()
    if size < MIN_DISTANCE and (second_size is None or second_size < MIN_DISTANCE):
        return finish(sharp)
    if second_size is not None and (size < MIN_DISTANCE or second_size < MIN_DISTANCE):
        raise OperationError("Both distances must be positive (both 0 leaves the sharp edge)")
    rebuilt = Topology(sharp)
    modified = []
    for n in neighbours:
        found = _follow(operation.History(), [n])
        if len(found) != 1:
            raise OperationError("Could not find the sharp edge left by this round")
        modified.append(found[0])
    shared = [e for _, e in rebuilt.edges() if all(any(f.IsSame(m) for f in rebuilt.edge_faces(e)) for m in modified)]
    if len(shared) != 1:
        raise OperationError("Could not find the sharp edge left by this round")
    if end_size > MIN_DISTANCE and not chamfer:
        from OCP.BRepFilletAPI import BRepFilletAPI_MakeFillet

        maker = BRepFilletAPI_MakeFillet(sharp)
        maker.Add(size, end_size, shared[0])
        try:
            maker.Build()
        except Exception as e:  # OCCT raises Standard_Failure for impossible sizes
            raise OperationError(f"Could not round: {e}") from None
        if not maker.IsDone() or maker.Shape().IsNull() or not BRepCheck_Analyzer(maker.Shape()).IsValid():
            raise OperationError("Could not round this edge with these radii")
        return finish(maker.Shape())
    if chamfer and second_size is not None and abs(second_size - size) > MIN_DISTANCE:
        from OCP.BRepFilletAPI import BRepFilletAPI_MakeChamfer
        from OCP.TopoDS import TopoDS

        maker = BRepFilletAPI_MakeChamfer(sharp)
        maker.Add(size, second_size, TopoDS.Edge(shared[0]), TopoDS.Face(modified[0]))  # `size` is measured on the first neighbour's face
        try:
            maker.Build()
        except Exception as e:  # OCCT raises Standard_Failure for impossible sizes
            raise OperationError(f"Could not chamfer: {e}") from None
        if not maker.IsDone() or maker.Shape().IsNull() or not BRepCheck_Analyzer(maker.Shape()).IsValid():
            raise OperationError("Could not chamfer this edge at these distances")
        return finish(maker.Shape())
    return finish(fillet_chamfer(sharp, shared, -size if chamfer else size).shape)


def _face_edges(face):
    from OCP.TopAbs import TopAbs_EDGE
    from OCP.TopExp import TopExp_Explorer
    from OCP.TopoDS import TopoDS

    explorer = TopExp_Explorer(face, TopAbs_EDGE)
    while explorer.More():
        yield TopoDS.Edge(explorer.Current())
        explorer.Next()

"""The Fillet per edge tool."""

from OCP.BRepCheck import BRepCheck_Analyzer

from ..ops import MIN_DISTANCE, OperationError, OpResult
from ..tools import Accepts, Param, register, Tool


@register
class FilletPerEdge(Tool):
    """Round the selected edges, each with its own radius. Per edge the form gives a start radius and an end
    radius: an end of 0 (or equal to the start) makes that edge constant, otherwise it is variable. A start of 0
    leaves that edge sharp."""

    id = "fillet_per_edge"
    label = "Fillet per edge"
    description = "Rounds several edges, each with its own radius. Select edges; the form lists one start and end radius per edge, and 0 leaves an edge sharp."
    accepts = Accepts(edges=(1, None))
    params = [Param("radii", "per_edge", 2)]

    def run(self, topology, selection, values, preview):
        from OCP.BRepFilletAPI import BRepFilletAPI_MakeFillet

        radii = values["radii"] or [[self.params[0].default, 0.0] for _ in selection.edges]
        if len(radii) != len(selection.edges):
            raise OperationError(f"Give one radius per edge: {len(selection.edges)} edges selected, {len(radii)} radii")
        maker = BRepFilletAPI_MakeFillet(topology.shape)
        edges = []
        # The kernel can leave stray zero-length edges at corners when edges are added in a different order than
        # the model stores them, so add them in id order whatever the order they were picked in.
        for edge_id, (start, end) in sorted(zip(selection.edges, radii), key=lambda pair: pair[0]):
            if start < 0 or end < 0:
                raise OperationError("Radii cannot be negative")
            if start < MIN_DISTANCE:
                continue  # left sharp
            edge = topology.edge(edge_id)
            edges.append(edge)
            if end < MIN_DISTANCE or abs(end - start) < MIN_DISTANCE:
                maker.Add(start, edge)
            else:
                maker.Add(start, end, edge)
        if not edges:
            raise OperationError("Every radius is 0: nothing to round")
        try:
            maker.Build()
        except Exception as e:
            raise OperationError(f"Could not round: {e}") from None
        if not maker.IsDone() or maker.Shape().IsNull() or not BRepCheck_Analyzer(maker.Shape()).IsValid():
            raise OperationError("Could not round these edges with these radii")
        return OpResult(maker.Shape(), [g for edge in edges for g in maker.Generated(edge)])

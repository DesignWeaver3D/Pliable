"""The Variable fillet tool."""

from OCP.BRepCheck import BRepCheck_Analyzer

from ..ops import edge_curve, edge_outward_normal, MIN_DISTANCE, OperationError, OpResult
from ..tools import Accepts, Handle, Param, register, Tool


@register
class VariableFillet(Tool):
    """Round edges with a radius that changes linearly from `start` at each edge's first vertex to `end` at its last."""

    id = "variable_fillet"
    label = "Variable fillet"
    description = "Rounds edges with a radius that changes along the edge, from the start value at its first end to the end value at its last. Select one or more edges."
    accepts = Accepts(edges=(1, None))
    params = [
        Param("start", "length", 1),
        Param("end", "length", 3),
        Param("reverse", "number", 0),  # 1 swaps which end gets which value
        Param("middle", "length", 0),  # radius at an interim point along the edge; 0 means none
        Param("middle_at", "number", 0.5),  # where along the edge (0 first end, 1 last end), measured after any reverse
    ]

    def handles(self, topology, selection, values):
        edge = topology.edge(selection.edges[0])
        normal = edge_outward_normal(topology, edge)
        if normal is None:
            return []
        at, tangent, length = edge_curve(edge)
        up = lambda point, size: tuple(p + n * size for p, n in zip(point, normal))  # noqa: E731  (a point lifted along the bisector)
        reverse = values["reverse"] >= 0.5
        lift = max(length * 0.08, 1.0)  # the interim and swap markers float this far above the edge so they never sit on the end handles
        found = [
            # The start value belongs to the edge's first end unless the ends are swapped.
            Handle("start", "Start radius", up(at(1.0 if reverse else 0.0), values["start"]), tuple(normal), min=MIN_DISTANCE),
            Handle("end", "End radius", up(at(0.0 if reverse else 1.0), values["end"]), tuple(normal), min=MIN_DISTANCE),
            Handle("reverse", "Swap the two ends (click)", up(at(0.12), lift), tuple(normal), toggle=True),
        ]
        if len(selection.edges) == 1:
            u = min(max(values["middle_at"], 0.02), 0.98)
            found.append(Handle("middle", "Radius at the interim point (0 = none)", up(at(u), values["middle"] + lift), tuple(normal), min=0.0))
            found.append(Handle("middle_at", "Interim point along the edge", at(u), tangent(u), scale=1 / max(length, MIN_DISTANCE), min=0.02, max=0.98, unit=""))
        return found

    def run(self, topology, selection, values, preview):
        from OCP.BRepFilletAPI import BRepFilletAPI_MakeFillet
        from OCP.collections import Array1_gp_Pnt2d
        from OCP.gp import gp_Pnt2d

        start, end, middle = values["start"], values["end"], values["middle"]
        if start < MIN_DISTANCE or end < MIN_DISTANCE:
            raise OperationError("Both radii must be positive")
        if middle < 0:
            raise OperationError("The radius at the chosen point cannot be negative")
        if middle >= MIN_DISTANCE and not 0.02 < values["middle_at"] < 0.98:
            raise OperationError("Choose the interim point between 0.02 and 0.98 of the way along the edge")
        if values["reverse"] >= 0.5:
            start, end = end, start
        maker = BRepFilletAPI_MakeFillet(topology.shape)
        edges = [topology.edge(i) for i in selection.edges]
        if middle >= MIN_DISTANCE and len(edges) != 1:
            raise OperationError("A radius at an interim point works on one edge at a time")
        for edge in edges:
            maker.Add(start, end, edge)
        if middle >= MIN_DISTANCE:
            points = Array1_gp_Pnt2d(1, 3)
            for k, (u, r) in enumerate(((0.0, start), (values["middle_at"], middle), (1.0, end)), 1):
                points.SetValue(k, gp_Pnt2d(u, r))
            maker.SetRadius(points, 1, 1)
        try:
            maker.Build()
        except Exception as e:  # OCCT raises Standard_Failure for impossible sizes
            raise OperationError(f"Could not round: {e}") from None
        if not maker.IsDone() or maker.Shape().IsNull() or not BRepCheck_Analyzer(maker.Shape()).IsValid():
            raise OperationError("Could not round these edges with these radii")
        return OpResult(maker.Shape(), [g for edge in edges for g in maker.Generated(edge)])

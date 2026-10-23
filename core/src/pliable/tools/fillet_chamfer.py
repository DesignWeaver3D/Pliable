"""The Fillet/Chamfer tool."""

from ..ops import edge_curve, edge_outward_normal, fillet_chamfer
from .base import Accepts, Handle, Param, register, Tool


@register
class FilletChamfer(Tool):
    """Dragging an edge outward rounds it (fillet), inward bevels it (chamfer)."""

    id = "fillet_chamfer"
    label = "Fillet/Chamfer"
    description = "Rounds or bevels the selected edges. Select edges, then drag outward to round (fillet) or inward to bevel (chamfer), or type a distance."
    accepts = Accepts(edges=(1, None))
    params = [Param("distance", "length", drag=True)]

    def handles(self, topology, selection, values):
        edge = topology.edge(min(selection.edges))
        normal = edge_outward_normal(topology, edge)
        if normal is None:
            return []
        at, _, _ = edge_curve(edge)
        mid = at(0.5)
        d = values["distance"]
        return [Handle("distance", "Round (outward) or bevel (inward)", tuple(m + n * d for m, n in zip(mid, normal)), tuple(normal))]

    def run(self, topology, selection, values, preview):
        edges = [topology.edge(i) for i in sorted(selection.edges)]  # id order avoids stray zero-length edges at corners
        return fillet_chamfer(topology.shape, edges, values["distance"])

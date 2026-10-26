"""The Round face edges tool."""

from ..shared.faces import _face_edges
from ..shared.solids import finish
from ..tools import Accepts, Handle, Param, register, Tool


@register
class RoundFace(Tool):
    """Fillet (positive) or chamfer (negative) every edge around the selected faces."""

    id = "round_face"
    label = "Round face edges"
    description = "Rounds (positive) or bevels (negative) every edge around the selected faces in one step. Select one or more faces."
    accepts = Accepts(faces=(1, None))
    params = [Param("distance", "length", 1)]

    def handles(self, topology, selection, values):
        from ..ops import edge_curve, edge_outward_normal

        # Like the Fillet/Chamfer handle: on the middle of the first edge of the first face, dragged outward to round and inward to bevel.
        edge = next(iter(_face_edges(topology.face(selection.faces[0]))), None)
        normal = edge_outward_normal(topology, edge) if edge is not None else None
        if normal is None:
            return []
        mid = edge_curve(edge)[0](0.5)
        d = values["distance"]
        return [Handle("distance", "Round (outward) or bevel (inward)", tuple(m + n * d for m, n in zip(mid, normal)), tuple(normal))]

    def run(self, topology, selection, values, preview):
        from ..ops import fillet_chamfer

        edges = []
        for i in selection.faces:
            for edge in _face_edges(topology.face(i)):
                if not any(edge.IsSame(e) for e in edges):
                    edges.append(edge)
        return finish(fillet_chamfer(topology.shape, edges, values["distance"]).shape)

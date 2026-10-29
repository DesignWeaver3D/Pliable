"""The Patch fill tool."""

from OCP.BRepFill import BRepFill_Filling
from OCP.GeomAbs import GeomAbs_C0, GeomAbs_G1

from ..ops import OperationError
from ..shared.solids import _sew_into
from ..tools import Accepts, Param, register, Tool


@register
class PatchFill(Tool):
    """Close a boundary of selected edges with a filled surface patch (continuity 0 = touching, 1 = tangent to the neighboring faces).
    Seals the patch to the model; if that closes a shell the result becomes a solid."""

    id = "patch_fill"
    label = "Patch fill"
    description = "Closes a gap bounded by selected edges with a smooth filled surface. Needs three or more selected edges forming a closed gap; continuity 1 = tangent to neighbors, 0 = just touching."
    accepts = Accepts(edges=(3, None))
    params = [Param("continuity", "number", 1)]

    def run(self, topology, selection, values, preview):
        fill = None
        # Tangent patches fail where the neighboring faces cannot be matched (e.g. a sharp box corner): retry touching only.
        for tangent in ([True, False] if values["continuity"] >= 0.5 else [False]):
            candidate = BRepFill_Filling()
            for edge_id in selection.edges:
                edge = topology.edge(edge_id)
                faces = topology.edge_faces(edge)
                if tangent and len(faces) == 1:
                    candidate.Add(edge, faces[0], GeomAbs_G1)
                else:
                    candidate.Add(edge, GeomAbs_C0)
            try:
                candidate.Build()
            except Exception:
                continue
            fill = candidate
            break
        if fill is None:
            raise OperationError("The edges do not form a boundary a patch can fill")
        if not fill.IsDone():
            raise OperationError("The patch could not be built from these edges")
        return _sew_into(topology.shape, fill.Face())

"""The Bridge edges tool."""

from ..ops import OperationError
from ..shared.solids import _faces_of, _sew_into
from ..tools import Accepts, register, Tool


@register
class Bridge(Tool):
    """Join two edges with a ruled surface (continuity 0), sewn to the model; a closed result becomes a solid."""

    id = "bridge"
    label = "Bridge edges"
    description = "Joins two edges with a straight-ruled surface. Select two edges."
    accepts = Accepts(edges=(2, 2))
    params = []

    def run(self, topology, selection, values, preview):
        # BRepFill.Face_s corrupts later OpenCASCADE fillets in the same process (spike 2026-10-17); a ruled ThruSections shell does not.
        from OCP.BRepBuilderAPI import BRepBuilderAPI_MakeWire
        from OCP.BRepOffsetAPI import BRepOffsetAPI_ThruSections

        loft = BRepOffsetAPI_ThruSections(False, True)
        for edge_id in selection.edges:
            loft.AddWire(BRepBuilderAPI_MakeWire(topology.edge(edge_id)).Wire())
        try:
            loft.Build()
        except Exception as error:
            raise OperationError("These edges cannot be bridged") from error
        face = next(_faces_of(loft.Shape()), None)
        if face is None:
            raise OperationError("These edges cannot be bridged")
        return _sew_into(topology.shape, face)

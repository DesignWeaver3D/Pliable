"""The Loft between faces tool."""

from ..ops import OperationError
from ..shared.solids import _combine, _volume, finish
from ..tools import Accepts, Param, register, Tool


def _outer_wire(face):
    from OCP.BRepTools import BRepTools as _BT

    return _BT.OuterWire_s(face)


@register
class LoftFaces(Tool):
    """Join two faces with a solid that blends from the outline of one to the other (`ruled` 1 = straight sides).
    The new solid is fused with the model."""

    id = "loft_faces"
    label = "Loft between faces"
    description = "Joins two faces with a solid that blends from one outline to the other. Select two faces; ruled 1 gives straight sides, 0 a smooth blend."
    accepts = Accepts(faces=(2, 2))
    params = [Param("ruled", "number", 0)]

    def run(self, topology, selection, values, preview):
        from OCP.BRepOffsetAPI import BRepOffsetAPI_ThruSections

        loft = BRepOffsetAPI_ThruSections(True, int(round(values["ruled"])) == 1)
        for face_id in selection.faces:
            loft.AddWire(_outer_wire(topology.face(face_id)))
        try:
            loft.Build()
        except Exception as e:
            raise OperationError(f"Could not loft between these faces: {e}") from None
        if not loft.IsDone() or loft.Shape().IsNull() or _volume(loft.Shape()) < 1e-9:
            raise OperationError("Could not loft between these faces")
        return finish(_combine(topology.shape, loft.Shape(), fuse=True))

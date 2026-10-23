"""The Sweep face along edge tool."""

from ..ops import OperationError
from ..shared.solids import _combine, _volume, finish
from ..tools import Accepts, Param, register, Tool


@register
class SweepFace(Tool):
    """Sweep the selected face along the selected edge (the path); `mode` 0 adds the swept solid, 1 cuts it."""

    id = "sweep_face"
    label = "Sweep face along edge"
    description = "Pulls a face along an edge to make a solid. Select one face and the edge to follow; mode 0 adds the solid, 1 cuts it."
    accepts = Accepts(faces=(1, 1), edges=(1, 1))
    params = [Param("mode", "number", 0)]

    def run(self, topology, selection, values, preview):
        from OCP.BRepBuilderAPI import BRepBuilderAPI_MakeWire
        from OCP.BRepOffsetAPI import BRepOffsetAPI_MakePipe

        mode = int(round(values["mode"]))
        if mode not in (0, 1):
            raise OperationError("Mode must be 0 (add) or 1 (cut)")
        path = BRepBuilderAPI_MakeWire(topology.edge(selection.edges[0])).Wire()
        pipe = BRepOffsetAPI_MakePipe(path, topology.face(selection.faces[0]))
        try:
            pipe.Build()
        except Exception as e:
            raise OperationError(f"Could not sweep along this edge: {e}") from None
        if not pipe.IsDone() or pipe.Shape().IsNull() or _volume(pipe.Shape()) < 1e-9:
            raise OperationError("Could not sweep this face along this edge")
        return finish(_combine(topology.shape, pipe.Shape(), fuse=mode == 0))

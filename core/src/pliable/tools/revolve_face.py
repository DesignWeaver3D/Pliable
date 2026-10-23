"""The Revolve face tool."""

import math

from OCP.BRepAdaptor import BRepAdaptor_Curve
from OCP.BRepPrimAPI import BRepPrimAPI_MakeRevol
from OCP.GeomAbs import GeomAbs_Line
from OCP.gp import gp_Ax1

from ..ops import OperationError
from ..shared.solids import _combine, _volume, finish
from ..tools import Accepts, Param, register, Tool


@register
class RevolveFace(Tool):
    """Sweep the selected face around the selected straight edge (the axis). `mode` 0 adds material, 1 cuts it."""

    id = "revolve_face"
    label = "Revolve face"
    description = "Spins a face around a straight edge to add or cut a round shape. Select one face and one straight edge as the axis; mode 0 adds material, 1 cuts."
    accepts = Accepts(faces=(1, 1), edges=(1, 1))
    params = [Param("angle", "angle", 360, drag=False), Param("mode", "number", 0)]

    def applies(self, topology, selection):
        return BRepAdaptor_Curve(topology.edge(selection.edges[0])).GetType() == GeomAbs_Line

    def run(self, topology, selection, values, preview):
        angle = values["angle"]
        if abs(angle) < 1e-6 or abs(angle) > 360 + 1e-6:
            raise OperationError("The angle must be between 0 and 360 degrees")
        mode = int(round(values["mode"]))
        if mode not in (0, 1):
            raise OperationError("Mode must be 0 (add) or 1 (cut)")
        line = BRepAdaptor_Curve(topology.edge(selection.edges[0])).Line()
        face = topology.face(selection.faces[0])
        revolved = BRepPrimAPI_MakeRevol(face, gp_Ax1(line.Location(), line.Direction()), math.radians(angle))
        revolved.Build()
        if not revolved.IsDone():
            raise OperationError("The face cannot be revolved around that edge (the axis must not cross the face)")
        before = _volume(topology.shape)
        result = _combine(topology.shape, revolved.Shape(), fuse=mode == 0)
        if abs(_volume(result) - before) < 1e-9:
            raise OperationError("Revolving changed nothing: the swept volume is already inside or outside the model")
        return finish(result)

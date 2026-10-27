"""The Revolve face tool."""

import math

from OCP.BRepAdaptor import BRepAdaptor_Curve
from OCP.BRepPrimAPI import BRepPrimAPI_MakeRevol
from OCP.GeomAbs import GeomAbs_Line
from OCP.gp import gp_Ax1, gp_Pnt, gp_Trsf, gp_Vec

from ..ops import OperationError, face_handle_point
from ..shared.solids import _combine, _volume, finish
from ..tools import Accepts, Handle, Param, register, Tool


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

    def handles(self, topology, selection, values):
        # A pie-slice grip like the circular array's: the ring the face's middle travels on, from the face (0) to the sweep angle.
        line = BRepAdaptor_Curve(topology.edge(selection.edges[0])).Line()
        direction, origin = line.Direction(), line.Location()
        centre = face_handle_point(topology.face(selection.faces[0]))
        along = gp_Vec(origin, centre).Dot(gp_Vec(direction))
        foot = origin.Translated(gp_Vec(direction).Multiplied(along))
        radius = foot.Distance(centre)
        if radius < 1e-6:
            return []
        turn = gp_Trsf()
        turn.SetRotation(gp_Ax1(origin, direction), math.radians(values["angle"]))
        p = centre.Transformed(turn)
        tangent = gp_Vec(direction).Crossed(gp_Vec(foot, p))
        tangent.Normalize()
        return [Handle("angle", "Revolve angle", (p.X(), p.Y(), p.Z()), (tangent.X(), tangent.Y(), tangent.Z()), scale=math.degrees(1 / radius), min=-360.0, max=360.0, unit="°",
                       axis=(direction.X(), direction.Y(), direction.Z()), ring=(foot.X(), foot.Y(), foot.Z(), radius), pie=True)]

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

"""The Draft tool."""

import math

from OCP.BRepBndLib import BRepBndLib
from OCP.BRepOffsetAPI import BRepOffsetAPI_DraftAngle
from OCP.Bnd import Bnd_Box
from OCP.gp import gp_Ax1, gp_Dir, gp_Pln, gp_Pnt, gp_Trsf, gp_Vec

from ..ops import face_handle_point, OperationError, planar_normal
from ..shared.faces import _PlanarFace
from ..shared.solids import finish, TOL
from ..tools import Accepts, Handle, Param, register


@register
class Draft(_PlanarFace):
    """Tilt flat faces by an angle about the lowest point of the model along the pull direction (default Z)."""

    id = "draft"
    label = "Draft"
    description = "Tilts flat faces by an angle so they release from a mold, pivoting about the lowest point along the pull direction (default Z). Select one or more flat faces."
    accepts = Accepts(faces=(1, None))
    params = [Param("angle", "angle", 3), Param("pull_x", "number"), Param("pull_y", "number"), Param("pull_z", "number", 1)]

    @staticmethod
    def _neutral_base(topology, direction) -> gp_Pnt:
        box = Bnd_Box()
        BRepBndLib.Add_s(topology.shape, box)
        lo, hi = box.CornerMin(), box.CornerMax()
        corners = [gp_Pnt(x, y, z) for x in (lo.X(), hi.X()) for y in (lo.Y(), hi.Y()) for z in (lo.Z(), hi.Z())]
        return min(corners, key=lambda p: gp_Vec(p.XYZ()).Dot(gp_Vec(direction)))

    def handles(self, topology, selection, values):
        """One ring about the line where the first face meets the neutral plane; its grip rides on the face and turns with the angle
        (a positive angle tilts the top of a wall toward its inside)."""
        pull = gp_Vec(values["pull_x"], values["pull_y"], values["pull_z"])
        face = topology.face(selection.faces[0])
        normal = planar_normal(face)
        if pull.Magnitude() < TOL or normal is None:
            return []
        direction = gp_Dir(pull)
        base = self._neutral_base(topology, direction)
        centre = face_handle_point(face)
        height = gp_Vec(base, centre).Dot(gp_Vec(direction))
        hinge = gp_Pnt(centre.X() - direction.X() * height, centre.Y() - direction.Y() * height, centre.Z() - direction.Z() * height)
        radius = gp_Vec(hinge, centre).Magnitude()
        axis = gp_Vec(normal).Crossed(gp_Vec(direction))
        if radius < 1e-6 or axis.Magnitude() < 1e-9:
            return []
        axis.Normalize()
        turn = gp_Trsf()
        turn.SetRotation(gp_Ax1(hinge, gp_Dir(axis)), math.radians(values["angle"]))
        anchor = centre.Transformed(turn)
        tangent = axis.Crossed(gp_Vec(hinge, anchor))
        tangent.Normalize()
        return [
            Handle("angle", "Draft angle", (anchor.X(), anchor.Y(), anchor.Z()), (tangent.X(), tangent.Y(), tangent.Z()), scale=math.degrees(1 / radius), unit="°", axis=(axis.X(), axis.Y(), axis.Z()), ring=(hinge.X(), hinge.Y(), hinge.Z(), radius))
        ]

    def run(self, topology, selection, values, preview):
        pull = gp_Vec(values["pull_x"], values["pull_y"], values["pull_z"])
        if pull.Magnitude() < TOL:
            raise OperationError("Give a pull direction")
        direction = gp_Dir(pull)
        base = self._neutral_base(topology, direction)
        neutral = gp_Pln(base, direction)
        maker = BRepOffsetAPI_DraftAngle(topology.shape)
        for i in selection.faces:
            maker.Add(topology.face(i), direction, math.radians(values["angle"]), neutral)
            if not maker.AddDone():
                raise OperationError(
                    "Could not draft that face: draft tilts side walls, so a face facing along the pull direction "
                    "(a top or bottom) or a face that is not flat cannot be drafted. Pick a side wall, or change the pull direction"
                )
        hint = "; try a smaller angle, or select every wall of the feature together (walls that meet the drafted face must tilt with it)"
        try:
            maker.Build()
        except Exception:
            raise OperationError("Could not draft these faces at this angle" + hint) from None
        if not maker.IsDone() or maker.Shape().IsNull():
            raise OperationError("Could not draft these faces at this angle" + hint)
        try:
            return finish(maker.Shape())
        except OperationError:
            raise OperationError("Drafting these faces would make the solid invalid" + hint) from None

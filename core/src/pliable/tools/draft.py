"""The Draft tool."""

import math

from OCP.BRepBndLib import BRepBndLib
from OCP.BRepGProp import BRepGProp
from OCP.GProp import GProp_GProps
from OCP.BRepOffsetAPI import BRepOffsetAPI_DraftAngle
from OCP.Bnd import Bnd_Box
from OCP.gp import gp_Ax1, gp_Dir, gp_Pln, gp_Pnt, gp_Trsf, gp_Vec

from ..ops import face_handle_point, OperationError, planar_normal
from ..shared.faces import _PlanarFace, _plane_axes
from ..shared.solids import finish, TOL
from ..tools import Accepts, Handle, Param, register


def _face_area(face) -> float:
    props = GProp_GProps()
    BRepGProp.SurfaceProperties_s(face, props)
    return props.Mass()


AXIS_CHOICES = ("Face centroid", "Picked point", "Model base")  # the value is the index


@register
class Draft(_PlanarFace):
    """Tilt flat faces by an angle about a neutral plane square to the pull direction (default Z): through each face's centroid, a picked point, or the lowest point of the model."""

    id = "draft"
    label = "Draft"
    description = "Tilts flat faces by an angle so they release from a mold, pivoting about the face centroid (or a picked axis point, or the model's lowest point) along the pull direction (default Z). Select one or more flat faces."
    accepts = Accepts(faces=(1, None))
    params = [
        Param("angle", "angle", 3),
        Param("pull_x", "number"),
        Param("pull_y", "number"),
        Param("pull_z", "number", 1),
        Param("axis", "number", 0, options=AXIS_CHOICES),  # where the face pivots: the neutral plane goes through it
        Param("axis_x", "number"),
        Param("axis_y", "number"),
        Param("axis_z", "number"),
    ]
    pick_axis = ("axis_x", "axis_y", "axis_z", "axis")  # the form's Pick axis button fills these and chooses "Picked point"

    @staticmethod
    def _neutral_base(topology, direction) -> gp_Pnt:
        box = Bnd_Box()
        BRepBndLib.Add_s(topology.shape, box)
        lo, hi = box.CornerMin(), box.CornerMax()
        corners = [gp_Pnt(x, y, z) for x in (lo.X(), hi.X()) for y in (lo.Y(), hi.Y()) for z in (lo.Z(), hi.Z())]
        return min(corners, key=lambda p: gp_Vec(p.XYZ()).Dot(gp_Vec(direction)))

    @staticmethod
    def _pivot(topology, face, direction, values) -> gp_Pnt:
        """The point the neutral plane goes through for `face`: its centroid, the picked axis point, or the model's lowest point."""
        choice = int(values.get("axis", 0))
        if choice == 1:
            return gp_Pnt(values["axis_x"], values["axis_y"], values["axis_z"])
        if choice == 2:
            return Draft._neutral_base(topology, direction)
        return _plane_axes(face)[0]

    def handles(self, topology, selection, values):
        """One ring about the line where the first face meets the neutral plane; its grip rides on the face and turns with the angle
        (a positive angle tilts the top of a wall toward its inside)."""
        pull = gp_Vec(values["pull_x"], values["pull_y"], values["pull_z"])
        face = topology.face(selection.faces[0])
        normal = planar_normal(face)
        if pull.Magnitude() < TOL or normal is None:
            return []
        direction = gp_Dir(pull)
        base = self._pivot(topology, face, direction, values)
        centre = face_handle_point(face)
        height = gp_Vec(base, centre).Dot(gp_Vec(direction))
        hinge = gp_Pnt(centre.X() - direction.X() * height, centre.Y() - direction.Y() * height, centre.Z() - direction.Z() * height)
        radius = gp_Vec(hinge, centre).Magnitude()
        axis = gp_Vec(normal).Crossed(gp_Vec(direction))
        if axis.Magnitude() < 1e-9:
            return []
        axis.Normalize()
        if radius < 1e-6:  # the hinge runs through the handle point (a centroid pivot): ride on a ring of the face's own size, up the face from it
            radius = max(math.sqrt(_face_area(face)) / 2, 1.0)
            up = axis.Crossed(gp_Vec(normal))
            centre = gp_Pnt(hinge.X() + up.X() * radius, hinge.Y() + up.Y() * radius, hinge.Z() + up.Z() * radius)
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
        maker = BRepOffsetAPI_DraftAngle(topology.shape)
        for i in selection.faces:
            face = topology.face(i)
            maker.Add(face, direction, math.radians(values["angle"]), gp_Pln(self._pivot(topology, face, direction, values), direction))
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

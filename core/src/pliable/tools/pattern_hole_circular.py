"""The Circular pattern tool."""

import math

from OCP.gp import gp_Ax1, gp_Dir, gp_Pnt, gp_Trsf, gp_Vec

from ..ops import OperationError
from ..shared.hole_groups import _CylinderFaces, _holes
from ..shared.solids import finish, TOL
from ..tools import Accepts, Handle, Param, register


@register
class CircularPatternHole(_CylinderFaces):
    """Copies of a hole or boss around an axis: `count` in total, spread over `angle` degrees (360 = full circle,
    evenly). The axis passes through (px, py, pz) in direction (ax, ay, az); the default is the Z axis through the origin."""

    id = "pattern_hole_circular"
    label = "Circular pattern"
    description = "Makes copies of a hole or boss around an axis. Select its round face, set the count and the angle to spread them over (360 = full circle); the axis defaults to Z through the origin."
    placement = ("px", "py", "pz")
    accepts = Accepts(faces=(1, 1))
    params = [
        Param("count", "number", 6),
        Param("angle", "angle", 360),
        Param("px", "length"),
        Param("py", "length"),
        Param("pz", "length"),
        Param("ax", "number"),
        Param("ay", "number"),
        Param("az", "number", 1),
    ]

    def handles(self, topology, selection, values):
        # The angle is a pie slice from the source hole round the axis, the count a number over the source (as on the circular array).
        direction = gp_Vec(values["ax"], values["ay"], values["az"])
        if direction.Magnitude() < TOL:
            return []
        try:
            (hole,) = _holes(topology, selection)
        except OperationError:
            return []
        axis = gp_Ax1(gp_Pnt(values["px"], values["py"], values["pz"]), gp_Dir(direction))
        middle = hole.origin.Translated(gp_Vec(hole.direction).Multiplied(hole.length / 2))
        along = gp_Vec(axis.Location(), middle).Dot(gp_Vec(axis.Direction()))
        foot = axis.Location().Translated(gp_Vec(axis.Direction()).Multiplied(along))
        radius = foot.Distance(middle)
        if radius < 1e-6:
            return []  # the hole sits on the axis: there is no ring to turn on
        turn = gp_Trsf()
        turn.SetRotation(axis, math.radians(values["angle"]))
        end = middle.Transformed(turn)
        tangent = gp_Vec(axis.Direction()).Crossed(gp_Vec(foot, end))
        tangent.Normalize()
        d = axis.Direction()
        return [
            Handle("angle", "Pattern angle", (end.X(), end.Y(), end.Z()), (tangent.X(), tangent.Y(), tangent.Z()), scale=math.degrees(1 / radius), min=-360.0, max=360.0, unit="°",
                   axis=(d.X(), d.Y(), d.Z()), ring=(foot.X(), foot.Y(), foot.Z(), radius), pie=True),
            Handle("count", "Count", (middle.X(), middle.Y(), middle.Z()), (0.0, 0.0, 1.0), min=2, max=200, unit="", badge=True),
        ]

    def run(self, topology, selection, values, preview):
        count = int(round(values["count"]))
        if not 2 <= count <= 200:
            raise OperationError("The count must be between 2 and 200")
        direction = gp_Vec(values["ax"], values["ay"], values["az"])
        if direction.Magnitude() < TOL:
            raise OperationError("Give an axis direction")
        axis = gp_Ax1(gp_Pnt(values["px"], values["py"], values["pz"]), gp_Dir(direction))
        total = values["angle"]
        step = total / count if abs(abs(total) - 360) < 1e-9 else total / (count - 1)
        (hole,) = _holes(topology, selection)
        shape = topology.shape
        for i in range(1, count):
            transform = gp_Trsf()
            transform.SetRotation(axis, math.radians(step * i))
            shape = hole.place(shape, transform=transform)
        return finish(shape)

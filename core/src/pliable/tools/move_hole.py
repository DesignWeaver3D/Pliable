"""The Move hole / boss tool."""

from OCP.gp import gp_Vec

from ..ops import MIN_DISTANCE, OperationError, OpResult
from ..shared.hole_groups import _CylinderFaces, _holes, apply_holes
from ..shared.solids import finish
from ..tools import Accepts, Handle, Param, register


@register
class MoveHole(_CylinderFaces):
    id = "move_hole"
    label = "Move hole / boss"
    description = "Moves a hole or boss by the given distances along X, Y and Z. Select its round face."
    related = ("equal_radius",)
    accepts = Accepts(faces=(1, None))
    params = [Param("dx", "length"), Param("dy", "length"), Param("dz", "length")]
    move_vector = ("dx", "dy", "dz")

    def handles(self, topology, selection, values):
        # Three move arrows (X, Y, Z) at the middle of the first selected hole or boss, at its moved position.
        try:
            hole = _holes(topology, selection)[0]
        except OperationError:
            return []  # a partly round cylinder (a fillet) has no hole axis to hang the arrows on
        middle = hole.origin.Translated(gp_Vec(hole.direction).Multiplied(hole.length / 2))
        now = (values["dx"], values["dy"], values["dz"])
        at = (middle.X() + now[0], middle.Y() + now[1], middle.Z() + now[2])
        return [Handle(name, f"Move along {label}", at, axis, kind="move") for name, label, axis in (("dx", "X", (1, 0, 0)), ("dy", "Y", (0, 1, 0)), ("dz", "Z", (0, 0, 1)))]

    def run(self, topology, selection, values, preview):
        offset = gp_Vec(values["dx"], values["dy"], values["dz"])
        shape = topology.shape
        if offset.Magnitude() < MIN_DISTANCE:
            return OpResult(shape, [topology.face(i) for i in selection.faces])
        from ..holes import follow_cylinder

        holes = _holes(topology, selection)
        result = finish(apply_holes(shape, holes, [(None, offset)] * len(holes)))
        for i in selection.faces:
            result.tracked_faces += follow_cylinder(result.shape, topology.face(i), offset)
        return result

"""The Helical sweep tool."""

from OCP.BRepOffsetAPI import BRepOffsetAPI_MakePipeShell
from OCP.gp import gp_Vec
from OCP.TopAbs import TopAbs_WIRE
from OCP.TopExp import TopExp_Explorer
from OCP.TopoDS import TopoDS

from ..ops import OperationError, face_handle_point, solids_of
from ..shared.arrayaxis import AXIS_CHOICES
from ..shared.helix import helix_wire
from ..shared.solids import _combine, _compound, _volume, finish
from ..tools import Accepts, Param, register
from .revolve_face import RevolveFace


@register
class HelicalSweep(RevolveFace):
    """Sweep the selected face along a helix around an axis (same axis choices as Revolve face). The helix starts at the face's middle,
    so its radius is the distance from the axis to that point. `mode` 0 adds a coil, 1 cuts a helical groove."""

    id = "helical_sweep"
    label = "Helical sweep"
    description = "Winds a face around a straight edge or global axis along a helix, to add a coil or thread or cut a helical groove. Select one face and an axis; the face should lie in a plane that contains the axis. Pitch is the advance per turn; mode 0 adds, 1 cuts."
    accepts = Accepts(faces=(1, 1), edges=(0, 1), axes=(0, 1))
    rail_accepts = None
    rail_regions = False
    params = [Param("pitch", "length", 10), Param("turns", "number", 5), Param("hand", "number", 0, options=("Right", "Left")),
              Param("mode", "number", 0), Param("axis", "number", 3, options=AXIS_CHOICES), Param("axis_edge", "number", -1)]

    def handles(self, topology, selection, values):
        return []

    def run(self, topology, selection, values, preview):
        pitch, turns, hand = values["pitch"], values["turns"], int(round(values["hand"]))
        if abs(pitch) < 1e-6 or turns < 1e-6:
            raise OperationError("The pitch and the number of turns must be greater than zero")
        mode = int(round(values["mode"]))
        if mode not in (0, 1):
            raise OperationError("Mode must be 0 (add) or 1 (cut)")
        axis = self._axis(topology, selection, values)
        face = topology.face(selection.faces[0])
        centre = face_handle_point(face)
        direction, origin = axis.Direction(), axis.Location()
        along = gp_Vec(origin, centre).Dot(gp_Vec(direction))
        foot = origin.Translated(gp_Vec(direction).Multiplied(along))
        radial = gp_Vec(foot, centre)
        radius = radial.Magnitude()
        if radius < 1e-6:
            raise OperationError("The face's middle lies on the axis; move the axis away from the face")
        spine = helix_wire(foot, direction, radial, radius, pitch, turns, left=bool(hand))
        explorer = TopExp_Explorer(face, TopAbs_WIRE)
        profile = TopoDS.Wire(explorer.Current())
        shell = BRepOffsetAPI_MakePipeShell(spine)
        shell.SetMode(direction)  # the profile keeps its angle to the axis, as in a screw thread
        shell.Add(profile)
        try:
            shell.Build()
            if shell.IsDone():
                shell.MakeSolid()
        except Exception as e:
            raise OperationError(f"The face cannot be wound along that helix: {e}") from None
        if not shell.IsDone() or shell.Shape().IsNull() or _volume(shell.Shape()) < 1e-9:
            raise OperationError("The face cannot be wound along that helix (the face should contain the axis direction and not cross the axis)")
        coil = shell.Shape()
        solids = solids_of(topology.shape)
        if solids:
            result = _combine(_compound(solids), coil, fuse=mode == 0)
        elif mode == 0:
            result = coil
        else:
            raise OperationError("There is no solid to cut")
        return finish(result)

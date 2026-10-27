"""The Helical sweep tool."""

from OCP.BRepBndLib import BRepBndLib
from OCP.Bnd import Bnd_Box
from OCP.BRepAlgoAPI import BRepAlgoAPI_Cut, BRepAlgoAPI_Fuse
from OCP.BRepBuilderAPI import BRepBuilderAPI_Transform
from OCP.BRepCheck import BRepCheck_Analyzer
from OCP.BRepOffsetAPI import BRepOffsetAPI_MakePipeShell
from OCP.gp import gp_Pnt, gp_Trsf, gp_Vec
from OCP.TopAbs import TopAbs_WIRE
from OCP.TopExp import TopExp_Explorer
from OCP.TopoDS import TopoDS

from ..ops import _contains, _faces_of, OperationError, face_handle_point, solids_of
from ..shared.arrayaxis import AXIS_CHOICES
from ..shared.helix import helix_wire
from ..shared.solids import _combine, _compound, _volume, finish
from ..sketch import SketchError, regions
from ..tools import Handle, Param, register
from .revolve_face import RevolveFace

MODES = ("Add", "Subtract")


def _apply(shape, piece, fuse: bool):
    """One boolean step. The turns of a coil touch end to end, which makes a step now and then come out invalid; a small fuzzy value fixes it."""
    result = _combine(shape, piece, fuse)
    for fuzzy in (1e-6, 1e-5, 1e-4):
        if BRepCheck_Analyzer(result).IsValid():
            return result
        operation = (BRepAlgoAPI_Fuse if fuse else BRepAlgoAPI_Cut)(shape, piece)
        operation.SetFuzzyValue(fuzzy)
        operation.Build()
        if operation.IsDone() and not operation.Shape().IsNull():
            result = operation.Shape()
    return result


@register
class HelicalSweep(RevolveFace):
    """Sweep the selected face (or every closed region of a chosen sketch) along a helix around an axis (same axis choices as Revolve
    face). Each helix starts at its face's middle, so its radius is the distance from the axis to that point. `mode` 0 adds a coil,
    1 subtracts it from every solid it meets."""

    id = "helical_sweep"
    label = "Helical sweep"
    description = "Winds a face (or a whole sketch in the Sketch list) around a straight edge or global axis along a helix, to add a coil or thread or subtract a helical groove from every solid it meets. Select one face and an axis; the face should lie in a plane that contains the axis. Pitch is the advance per turn."
    params = [Param("mode", "number", 0, options=MODES), Param("pitch", "length", 10), Param("turns", "number", 5), Param("hand", "number", 0, options=("Right", "Left")),
              Param("axis", "number", 3, options=AXIS_CHOICES), Param("axis_edge", "number", -1)]

    def _frame(self, face, axis):
        """The face's middle, the point of the axis nearest it, the axis direction and the radius (the distance between the two points)."""
        centre = face_handle_point(face)
        direction, origin = axis.Direction(), axis.Location()
        along = gp_Vec(origin, centre).Dot(gp_Vec(direction))
        foot = origin.Translated(gp_Vec(direction).Multiplied(along))
        return centre, foot, direction, gp_Vec(foot, centre)

    def handles(self, topology, selection, values):
        # Pitch is a length dimension along the axis, drawn outside the profile on the side away from the axis, with an extension line at each end
        # running back in to the profile's middle line, an arrowhead grip and the value in the middle of the line; turns is a number at the start of it
        # (the wheel and double-click change it, as the circular array's count).
        try:
            axis = self._axis(topology, selection, values)
            if selection.faces:
                face = topology.face(selection.faces[0])
            else:
                face = regions(selection.rail_content)[0].wrapped
        except (OperationError, KeyError, TypeError, ValueError, IndexError, SketchError):
            return []
        centre, foot, direction, radial = self._frame(face, axis)
        radius = radial.Magnitude()
        if radius < 1e-6:
            return []
        inward = gp_Vec(centre, foot).Normalized()
        along = gp_Vec(direction)
        box = Bnd_Box()
        BRepBndLib.Add_s(face, box)
        lo, hi = box.CornerMin(), box.CornerMax()
        reach = max(gp_Vec(centre, gp_Pnt(x, y, z)).Dot(inward.Reversed()) for x in (lo.X(), hi.X()) for y in (lo.Y(), hi.Y()) for z in (lo.Z(), hi.Z()))
        gap = max(reach, 0.0) + 2.0  # the dimension line runs this far outside the profile, on the side away from the axis
        away = inward.Reversed()
        start = centre.Translated(away.Multiplied(gap))
        end = start.Translated(along.Multiplied(values["pitch"]))
        number = start.Translated(along.Reversed().Multiplied(gap))  # the turns number sits just before the dimension line starts
        reachback = inward.Multiplied(gap)  # the extension lines run from the dimension line back in to the profile's middle line
        return [
            Handle("pitch", "Pitch", (end.X(), end.Y(), end.Z()), (direction.X(), direction.Y(), direction.Z()), min=0.01, kind="resize", arrowhead=True,
                   axis_from=(start.X(), start.Y(), start.Z()), extension=(reachback.X(), reachback.Y(), reachback.Z())),
            Handle("turns", "Turns", (number.X(), number.Y(), number.Z()), (direction.X(), direction.Y(), direction.Z()), min=0.1, max=200, unit="", badge=True),
        ]

    def _turn(self, face, foot, direction, radial, radius, values, turns):
        spine = helix_wire(foot, direction, radial, radius, values["pitch"], turns, left=int(round(values["hand"])) == 1)
        shell = BRepOffsetAPI_MakePipeShell(spine)
        shell.SetMode(direction)  # the profile keeps its angle to the axis, as in a screw thread
        shell.Add(TopoDS.Wire(TopExp_Explorer(face, TopAbs_WIRE).Current()))
        try:
            shell.Build()
            if shell.IsDone():
                shell.MakeSolid()
        except Exception as e:
            raise OperationError(f"The face cannot be wound along that helix: {e}") from None
        if not shell.IsDone() or shell.Shape().IsNull() or _volume(shell.Shape()) < 1e-9:
            raise OperationError("The face cannot be wound along that helix (the face should contain the axis direction and not cross the axis)")
        return shell.Shape()

    def _coil(self, face, axis, values):
        """The coil as pieces that are applied one after another: whole turns are copies of one turn moved along the axis by the pitch,
        and a last piece holds the part turn. (One long sweep fails in boolean operations where it runs off the end of a solid.)"""
        centre, foot, direction, radial = self._frame(face, axis)
        radius = radial.Magnitude()
        if radius < 1e-6:
            raise OperationError("The face's middle lies on the axis; move the axis away from the face")
        whole, part = divmod(values["turns"], 1.0)
        if values["turns"] - round(values["turns"]) == 0 or part > 1 - 1e-9:
            whole, part = round(values["turns"]), 0.0
        pieces = []
        if whole:
            one = self._turn(face, foot, direction, radial, radius, values, 1.0)
            for k in range(int(whole)):
                move = gp_Trsf()
                move.SetTranslation(gp_Vec(direction).Multiplied(values["pitch"] * k))
                pieces.append(BRepBuilderAPI_Transform(one, move, True).Shape())
        if part > 1e-6:
            rest = self._turn(face, foot, direction, radial, radius, values, part)
            move = gp_Trsf()
            move.SetTranslation(gp_Vec(direction).Multiplied(values["pitch"] * whole))
            pieces.append(BRepBuilderAPI_Transform(rest, move, True).Shape())
        return pieces

    def run(self, topology, selection, values, preview):
        if abs(values["pitch"]) < 1e-6 or values["turns"] < 1e-6:
            raise OperationError("The pitch and the number of turns must be greater than zero")
        mode = int(round(values["mode"]))
        if mode not in (0, 1):
            raise OperationError("Mode must be Add or Subtract")
        axis = self._axis(topology, selection, values)
        if selection.faces:
            face = topology.face(selection.faces[0])
            faces = [face]
        else:  # a whole sketch was chosen: each of its closed regions is wound
            try:
                faces = [f.wrapped for f in regions(selection.rail_content)]
            except (KeyError, TypeError, ValueError, SketchError) as e:
                raise OperationError(f"The sketch cannot be wound: {e}") from None
            if not faces:
                raise OperationError("The sketch has no closed region to wind")
            face = None
        coils = [piece for each in faces for piece in self._coil(each, axis, values)]
        solids = solids_of(topology.shape)
        loose = [f for f in _faces_of(topology.shape) if not any(_contains(solid, f) for solid in solids)]  # sketch regions picked as faces
        kept = [f for f in loose if face is None or not f.IsSame(face)]  # the picked face is used up
        if mode == 0:
            result = _compound(solids) if solids else coils.pop(0)
            for piece in coils:
                result = _apply(result, piece, fuse=True)
        else:
            if not solids:
                raise OperationError("There is no solid to subtract from")
            pieces, changed = [], False
            for solid in solids:  # every solid the coil meets loses that part; the others stay as they are
                cut = solid
                for piece in coils:
                    cut = _apply(cut, piece, fuse=False)
                if abs(_volume(cut) - _volume(solid)) > 1e-9:
                    changed = True
                    pieces.extend(solids_of(cut))
                else:
                    pieces.append(solid)
            if not changed:
                raise OperationError("The coil does not meet any solid, so nothing was subtracted")
            result = _compound(pieces)
        if kept:
            result = _compound([result, *kept])
        return finish(result)

"""The Thread hole tool."""

import math

from OCP.BRepAdaptor import BRepAdaptor_Surface
from OCP.BRepBuilderAPI import BRepBuilderAPI_MakeFace, BRepBuilderAPI_MakePolygon
from OCP.BRepTools import BRepTools
from OCP.GeomAbs import GeomAbs_Cylinder
from OCP.gp import gp_Ax1, gp_Dir, gp_Pnt, gp_Vec

from ..hole_bore import bore_wall
from ..holes import find_hole, NOT_ROUND, _inward
from ..ops import _contains, OperationError, solids_of
from ..shared.solids import _compound, _volume, finish
from ..tools import Accepts, Param, register, Tool
from .helical_sweep import HelicalSweep, _apply

# The metric coarse pitch of each standard size (millimeters); "Custom" uses the Pitch box.
SIZES = ("Custom", "M3", "M4", "M5", "M6", "M8", "M10", "M12", "M14", "M16", "M20")
COARSE = (None, 0.5, 0.7, 0.8, 1.0, 1.25, 1.5, 1.75, 2.0, 2.0, 2.5)
FULL_TURN = 2 * math.pi - 1e-6
DEPTH_RATIO = 0.5413  # thread depth as a fraction of the pitch (the ISO internal thread, 5/8 of the sharp-V height)


@register
class ThreadHole(Tool):
    """A modeled thread: a helical groove cut into the wall of a round hole, wound along its whole length by default. The hole is the
    tapped core of the thread; the groove goes out from it by `depth` (0 = the standard depth for the pitch)."""

    id = "thread_hole"
    label = "Thread hole"
    description = "Cuts a thread (a helical groove) into the wall of a round hole. Select the hole's round wall, then pick a standard size or type a pitch; the groove runs the whole wall unless you give a length."
    accepts = Accepts(faces=(1, 1))
    params = [Param("size", "number", 0, options=SIZES), Param("pitch", "length", 1.25), Param("depth", "length", 0), Param("length", "length", 0), Param("hand", "number", 0, options=("Right", "Left"))]

    @staticmethod
    def _wall(topology, selection) -> int:
        """The face to thread: the bore wall of the hole the picked face belongs to (so a counterbore wall, a shoulder or a cone leads to the bore), else the picked face."""
        return bore_wall(topology, selection.faces[0]) if bore_wall(topology, selection.faces[0]) is not None else selection.faces[0]

    @staticmethod
    def _open_ends(topology, face, direction) -> tuple[bool, bool]:
        """(low, high): whether the hole is open at the wall's low and high end along the axis. A through hole is open at both; a blind hole
        only where it starts; a wall that is not part of a hole counts as open at both ends."""
        try:
            info = find_hole(topology, face_id=topology.face_id(face), reach=False)
        except OperationError:
            return True, True
        if info.through:
            return True, True
        opens_low = info.direction.Dot(direction) > 0
        return opens_low, not opens_low

    def applies(self, topology, selection):
        face = topology.face(self._wall(topology, selection))
        return BRepAdaptor_Surface(face).GetType() == GeomAbs_Cylinder and _inward(face)

    def refusal(self, topology, selection):
        return NOT_ROUND if self.accepts.matches(selection) else None

    def run(self, topology, selection, values, preview):
        face = topology.face(self._wall(topology, selection))
        surface = BRepAdaptor_Surface(face)
        if surface.GetType() != GeomAbs_Cylinder or not _inward(face):
            raise OperationError(NOT_ROUND)
        size = int(round(values["size"]))
        pitch = COARSE[size] if 0 < size < len(SIZES) else values["pitch"]
        if pitch < 1e-6:
            raise OperationError("The pitch must be greater than zero")
        depth = values["depth"] if values["depth"] > 1e-9 else DEPTH_RATIO * pitch
        cylinder = surface.Cylinder()
        radius, axis = cylinder.Radius(), cylinder.Axis()
        u0, u1, v0, v1 = BRepTools.UVBounds_s(face)
        if u1 - u0 < FULL_TURN:
            raise OperationError("Select the whole round wall of the hole (this face is only part of it)")
        room = (v1 - v0) if values["length"] <= 1e-9 else min(values["length"], v1 - v0)
        if room < 1.5 * pitch:
            raise OperationError("The hole wall is too short for even one turn of this pitch")
        # The groove's middle runs from half a pitch in to half a pitch short of the end; at an open end of the hole it goes one turn
        # further, so the cut leaves through the opening (a blind hole's bottom keeps its stop).
        low_open, high_open = self._open_ends(topology, face, axis.Direction())
        start = (0.5 - (1 if low_open else 0)) * pitch
        stop = room - 0.5 * pitch + (pitch if high_open and room >= v1 - v0 - 1e-9 else 0)
        turns = (stop - start) / pitch
        direction = axis.Direction()
        across = gp_Dir(direction.Crossed(gp_Dir(1, 0, 0))) if abs(direction.X()) < 0.9 else gp_Dir(direction.Crossed(gp_Dir(0, 1, 0)))

        def at(along: float, out: float) -> gp_Pnt:
            return axis.Location().Translated(gp_Vec(direction).Multiplied(v0 + along)).Translated(gp_Vec(across).Multiplied(out))

        # The groove's profile in a plane through the axis: wide at the wall (three quarters of the pitch), narrow at its root; it starts a little
        # inside the hole so the cut opens cleanly.
        inside = 0.1 * depth
        first = start
        polygon = BRepBuilderAPI_MakePolygon(at(first - 0.375 * pitch, radius - inside), at(first + 0.375 * pitch, radius - inside), at(first + 0.0625 * pitch, radius + depth), at(first - 0.0625 * pitch, radius + depth), True)
        profile = BRepBuilderAPI_MakeFace(polygon.Wire()).Face()
        coils = HelicalSweep()._coil(profile, gp_Ax1(axis.Location(), direction), {"pitch": pitch, "turns": turns, "hand": values["hand"]})
        solids = solids_of(topology.shape)
        pieces, changed = [], False
        for solid in solids:
            cut = solid
            if _contains(solid, face):
                for piece in coils:
                    cut = _apply(cut, piece, fuse=False)
                changed = abs(_volume(cut) - _volume(solid)) > 1e-9
            pieces.extend(solids_of(cut) if cut is not solid else [solid])
        if not changed:
            raise OperationError("The thread did not cut anything; check the pitch and length")
        return finish(_compound(pieces))

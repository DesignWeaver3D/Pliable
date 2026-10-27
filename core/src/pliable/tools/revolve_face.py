"""The Revolve face tool."""

import math

from OCP.BRepAdaptor import BRepAdaptor_Curve
from OCP.BRepPrimAPI import BRepPrimAPI_MakeRevol
from OCP.GeomAbs import GeomAbs_Line
from OCP.gp import gp_Ax1, gp_Pnt, gp_Trsf, gp_Vec

from ..ops import _contains, _faces_of, OperationError, face_handle_point, solids_of
from ..shared.arrayaxis import AXIS_CHOICES, array_axis
from ..shared.solids import _combine, _compound, _volume, finish
from ..sketch import SketchError, regions
from ..tools import Accepts, Handle, Param, register, Tool


@register
class RevolveFace(Tool):
    """Sweep the selected face around an axis: a selected straight edge or global axis, else the form's `axis` (the X, Y or Z axis
    through the origin, or the picked edge `axis_edge`). `mode` 0 (Add) adds material, 1 (Subtract) cuts it."""

    id = "revolve_face"
    label = "Revolve face"
    description = "Spins a face around a straight edge to add or cut a round shape. Select one face (or a whole sketch in the Sketch list, which revolves all its regions), then a straight edge or a global axis as the axis (or pick it after starting the tool); Add adds material and Subtract cuts."
    accepts = Accepts(faces=(1, 1), edges=(0, 1), axes=(0, 1))
    rail_accepts = Accepts(edges=(0, 1), axes=(0, 1), any_of=True)  # a whole chosen sketch plus an edge or axis: its regions are the faces
    rail_regions = True
    params = [Param("mode", "number", 0, options=("Add", "Subtract")), Param("angle", "angle", 360, drag=False), Param("axis", "number", 3, options=AXIS_CHOICES), Param("axis_edge", "number", -1)]
    pick_edge = ("axis_edge", "axis")  # the form's Pick axis edge button fills the edge id and chooses "Picked edge"

    def applies(self, topology, selection):
        if len(selection.edges) + len(selection.axes) > 1:
            return False  # one axis only
        return not selection.edges or BRepAdaptor_Curve(topology.edge(selection.edges[0])).GetType() == GeomAbs_Line

    def _axis(self, topology, selection, values) -> gp_Ax1:
        if selection.edges:
            line = BRepAdaptor_Curve(topology.edge(selection.edges[0])).Line()
            return gp_Ax1(line.Location(), line.Direction())
        if selection.axes:
            return array_axis(topology, {"axis": selection.axes[0]})
        choice, index = int(round(values.get("axis", 3))), int(round(values.get("axis_edge", -1)))
        if choice == 3:
            if not 0 <= index < topology.edge_count:
                raise OperationError("Pick the axis: a straight edge or a global axis")
            if BRepAdaptor_Curve(topology.edge(index)).GetType() != GeomAbs_Line:
                raise OperationError("Pick a straight edge for the axis")
        return array_axis(topology, values)

    def handles(self, topology, selection, values):
        # A pie-slice grip like the circular array's: the ring the face's middle travels on, from the face (0) to the sweep angle.
        if not selection.faces:
            return []
        try:
            axis = self._axis(topology, selection, values)  # a selected edge or global axis, or the form's choice
        except OperationError:
            return []
        direction, origin = axis.Direction(), axis.Location()
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
            raise OperationError("Mode must be Add or Subtract")
        axis = self._axis(topology, selection, values)
        if selection.faces:
            face = topology.face(selection.faces[0])
            faces = [face]
        else:  # a whole sketch was chosen: each of its closed regions is revolved
            try:
                faces = [f.wrapped for f in regions(selection.rail_content)]
            except (KeyError, TypeError, ValueError, SketchError) as e:
                raise OperationError(f"The sketch cannot be revolved: {e}") from None
            if not faces:
                raise OperationError("The sketch has no closed region to revolve")
            face = None
        swept = []
        for each in faces:
            revolved = BRepPrimAPI_MakeRevol(each, axis, math.radians(angle))
            revolved.Build()
            if not revolved.IsDone():
                raise OperationError("The face cannot be revolved around that axis (the axis must not cross the face)")
            swept.append(revolved.Shape())
        tool_shape = swept[0] if len(swept) == 1 else _compound(swept)
        before = _volume(topology.shape)
        solids = solids_of(topology.shape)
        loose = [f for f in _faces_of(topology.shape) if not any(_contains(solid, f) for solid in solids)]  # sketch regions picked as faces
        if solids:  # booleans run on the solids alone; the other loose faces are put back afterwards (the picked one is used up)
            result = _combine(_compound(solids), tool_shape, fuse=mode == 0)
        elif mode == 0:
            result = tool_shape
        else:
            raise OperationError("There is no solid to cut")
        if loose:
            result = _compound([result, *[f for f in loose if (face is None or not f.IsSame(face))]])
        if abs(_volume(result) - before) < 1e-9:
            raise OperationError("Revolving changed nothing: the swept volume is already inside or outside the model")
        return finish(result)

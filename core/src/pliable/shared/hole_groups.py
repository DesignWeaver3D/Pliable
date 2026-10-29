"""Hole lookup and the base classes of the tools that edit or place holes."""

import math

from OCP.BRepAdaptor import BRepAdaptor_Surface
from OCP.BRepBuilderAPI import BRepBuilderAPI_Transform
from OCP.BRepTools import BRepTools
from OCP.GeomAbs import GeomAbs_Cylinder
from OCP.TopAbs import TopAbs_REVERSED
from OCP.TopoDS import TopoDS_Shape
from OCP.gp import gp_Dir, gp_Pnt, gp_Trsf, gp_Vec

from ..ops import MIN_DISTANCE, OperationError, OpResult
from ..splitwalls import wall_chain
from ..tools import Accepts, Param, Tool
from .faces import _PlanarFace, _plane_axes
from .solids import _bounds_diagonal, _combine, _compound, _cylinder, finish


class Hole:
    """A cylindrical face read as a hole: where its axis starts, which way it runs, its radius and length."""

    def __init__(self, face, split: bool = False):
        surface = BRepAdaptor_Surface(face)
        if surface.GetType() != GeomAbs_Cylinder:
            raise OperationError("Select the cylindrical wall of a hole")
        cylinder = surface.Cylinder()
        u0, u1, v0, v1 = BRepTools.UVBounds_s(face)
        if u1 - u0 < 2 * math.pi - 1e-6 and not split:
            raise OperationError("That cylinder face is only partly round (a fillet?); select a full hole wall")
        axis = cylinder.Axis()
        self.direction = axis.Direction()
        self.origin = axis.Location().Translated(gp_Vec(self.direction).Multiplied(v0))
        self.radius = cylinder.Radius()
        self.length = v1 - v0
        # The face's outward (material) normal points away from the axis for a boss, toward it for a hole.
        self.boss = face.Orientation() != TopAbs_REVERSED

    @classmethod
    def of(cls, topology, face_id: int) -> "Hole":
        """The hole or boss of a wall face; one face of a wall that is split into several faces stands for the whole wall."""
        return cls(topology.face(face_id), split=len(wall_chain(topology, face_id)) > 1)

    @classmethod
    def of_selection(cls, topology, selection) -> list["Hole"]:
        """One hole per selected wall (two selected halves of one split wall give one hole)."""
        seen: set[int] = set()
        holes = []
        for i in selection.faces:
            if i in seen:
                continue
            seen.update(wall_chain(topology, i))
            holes.append(cls.of(topology, i))
        return holes

    def solid(self, radius: float | None = None, offset: gp_Vec | None = None) -> TopoDS_Shape:
        origin = self.origin.Translated(offset) if offset is not None else self.origin
        return _cylinder(origin, self.direction, self.radius if radius is None else radius, self.length)


    def clear(self, shape: TopoDS_Shape) -> TopoDS_Shape:
        """The model as if this hole or boss were absent (hole filled, boss cut away)."""
        return _combine(shape, self.solid(), fuse=not self.boss)

    def place(self, shape: TopoDS_Shape, radius: float | None = None, offset: gp_Vec | None = None, transform: gp_Trsf | None = None) -> TopoDS_Shape:
        """Add a hole (or boss) like this one, optionally with another radius or position, or moved by a transform."""
        solid = self.solid(radius, offset)
        if transform is not None:
            solid = BRepBuilderAPI_Transform(solid, transform, True).Shape()
        return _combine(shape, solid, fuse=self.boss)


def apply_holes(shape: TopoDS_Shape, holes: list["Hole"], moves: list[tuple[float | None, gp_Vec | None]] | None = None) -> TopoDS_Shape:
    """Clear every hole or boss, then (if `moves` is given: one (radius, offset) per hole) place the replacements.
    All holes of a kind go through one boolean, so editing hundreds of equal holes stays fast."""
    for boss in (False, True):
        group = [h for h in holes if h.boss == boss]
        if group:
            shape = _combine(shape, _compound([h.solid() for h in group]), fuse=not boss)
    if moves is not None:
        for boss in (False, True):
            solids = [h.solid(radius, offset) for h, (radius, offset) in zip(holes, moves) if h.boss == boss]
            if solids:
                shape = _combine(shape, _compound(solids), fuse=boss)
    return shape


def _holes(topology, selection) -> list[Hole]:
    return Hole.of_selection(topology, selection)


class _CylinderFaces(Tool):
    def applies(self, topology, selection):
        return all(BRepAdaptor_Surface(topology.face(i)).GetType() == GeomAbs_Cylinder for i in selection.faces)

    def refusal(self, topology, selection):
        from ..holes import NOT_ROUND

        return NOT_ROUND if self.accepts.matches(selection) else None


class _HoleOnFace(_PlanarFace):
    """Shared placement for holes cut into a flat face: positioned from the face centre, running inward."""

    accepts = Accepts(faces=(1, 1))
    params = [Param("diameter", "length", 6), Param("depth", "length"), Param("offset_u", "length"), Param("offset_v", "length")]

    def extra_handles(self, frame, values: dict, depth: float) -> list:
        """Handles for the parameters of the tool beyond the bore's own; `depth` is the bore's real depth."""
        return []

    def handles(self, topology, selection, values):
        from .newhole_handles import depth_handle, diameter_handles, Frame, position_handles, through_depth

        frame = Frame(topology.face(selection.faces[0]), values)
        depth = values["depth"] if values["depth"] > MIN_DISTANCE else through_depth(topology.shape, frame)
        return [*diameter_handles(frame, "diameter", "Hole", values["diameter"]), depth_handle(frame, "depth", "Hole depth (end = through)", depth), *position_handles(frame, depth), *self.extra_handles(frame, values, depth)]

    def extra_cutters(self, start: gp_Pnt, normal: gp_Dir, values: dict, depth: float, margin: float) -> list[TopoDS_Shape]:
        """Shapes to cut besides the main bore; `start` is on the face plane, `margin` the lead-in above it."""
        return []

    def run(self, topology, selection, values, preview):
        if values["diameter"] < MIN_DISTANCE:
            raise OperationError("The diameter must be positive")
        face = topology.face(selection.faces[0])
        centre, normal, u, v = _plane_axes(face)
        start = centre.Translated(gp_Vec(u).Multiplied(values["offset_u"])).Translated(gp_Vec(v).Multiplied(values["offset_v"]))
        depth = values["depth"] if values["depth"] > MIN_DISTANCE else _bounds_diagonal(topology.shape)
        # Cylinders start a little outside the face so the cut is clean, and run inward.
        margin = 0.01 * depth + 1e-3
        lead = start.Translated(gp_Vec(normal).Multiplied(margin))
        shape = _combine(topology.shape, _cylinder(lead, normal.Reversed(), values["diameter"] / 2, depth + margin), fuse=False)
        for cutter in self.extra_cutters(start, normal, values, depth, margin):
            shape = _combine(shape, cutter, fuse=False)
        return finish(shape, self._ghost_cutters(start, normal, values, depth) if preview and values["depth"] > MIN_DISTANCE else ())

    def _ghost_cutters(self, start: gp_Pnt, normal: gp_Dir, values: dict, depth: float) -> list[TopoDS_Shape]:
        """The cutting shapes for the preview's ghost: as cut, but starting on the face (no lead-in) so a hole inside the model has none.
        A through hole (depth 0) has no real end, so its cutting length past the model is not drawn."""
        return [_cylinder(start, normal.Reversed(), values["diameter"] / 2, depth), *self.extra_cutters(start, normal, values, depth, 0.0)]


class _HoleGroup(_CylinderFaces):
    """Tools that reposition several holes along a model axis (0 = X, 1 = Y, 2 = Z)."""

    @staticmethod
    def _axis(values) -> int:
        axis = int(round(values["axis"]))
        if axis not in (0, 1, 2):
            raise OperationError("The axis must be 0 (X), 1 (Y) or 2 (Z)")
        return axis

    @staticmethod
    def _centre(hole: Hole, axis: int) -> float:
        middle = hole.origin.Translated(gp_Vec(hole.direction).Multiplied(hole.length / 2))
        return (middle.X(), middle.Y(), middle.Z())[axis]

    def _shift(self, topology, holes: list[Hole], deltas: list[float], axis: int) -> OpResult:
        moves = [(None, gp_Vec(*(delta if k == axis else 0.0 for k in range(3)))) for delta in deltas]
        keep = [(h, m) for h, m, d in zip(holes, moves, deltas) if abs(d) >= MIN_DISTANCE]
        if not keep:
            return OpResult(topology.shape, [])
        return finish(apply_holes(topology.shape, [h for h, _ in keep], [m for _, m in keep]))

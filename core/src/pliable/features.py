"""Feature tools beyond push/pull and fillet: delete face (heal), hole edits, primitives, shell, mirror, draft.

Every tool is registered with `@register` and shows up in the UI's tool list without frontend changes.
Holes are edited by fusing the old cylinder back in (which fills the hole exactly) and cutting a new one,
so no history or topological naming is needed: the tool reads what the face is now.
"""

import math

from OCP.BRepAdaptor import BRepAdaptor_Curve, BRepAdaptor_Surface
from OCP.BRepAlgoAPI import BRepAlgoAPI_Defeaturing
from OCP.BRepBuilderAPI import BRepBuilderAPI_Copy, BRepBuilderAPI_MakeSolid, BRepBuilderAPI_Sewing, BRepBuilderAPI_Transform
from OCP.BRepFill import BRepFill_Filling
from OCP.TopAbs import TopAbs_FACE, TopAbs_SHELL
from OCP.TopExp import TopExp_Explorer as _Explorer
from OCP.BRepCheck import BRepCheck_Analyzer
from OCP.BRepGProp import BRepGProp
from OCP.BRepOffsetAPI import BRepOffsetAPI_DraftAngle, BRepOffsetAPI_MakeThickSolid
from OCP.BRepPrimAPI import BRepPrimAPI_MakeBox, BRepPrimAPI_MakeCone, BRepPrimAPI_MakeCylinder, BRepPrimAPI_MakeRevol, BRepPrimAPI_MakeSphere, BRepPrimAPI_MakeTorus
from OCP.BRepBndLib import BRepBndLib
from OCP.Bnd import Bnd_Box
from OCP.BRepTools import BRepTools
from OCP.GProp import GProp_GProps
from OCP.TopAbs import TopAbs_REVERSED
from OCP.GeomAbs import GeomAbs_C0, GeomAbs_G1, GeomAbs_Cylinder, GeomAbs_Line, GeomAbs_Plane, GeomAbs_Torus
from OCP.ShapeUpgrade import ShapeUpgrade_UnifySameDomain
from OCP.BRep import BRep_Builder
from OCP.TopoDS import TopoDS, TopoDS_Compound, TopoDS_Shape
from OCP.collections import List_TopoDS_Shape
from OCP.gp import gp_Ax1, gp_Ax2, gp_Dir, gp_Pln, gp_Pnt, gp_Trsf, gp_Vec

from .ops import MIN_DISTANCE, OperationError, OpResult, _boolean, _contains, planar_normal, push_pull, solids_of
from .tools import Accepts, Param, Tool, get_tool, register

TOL = 1e-6


def finish(shape: TopoDS_Shape) -> OpResult:
    """Merge faces that share a surface, check the result, and return it (the selection is not carried over)."""
    copy = BRepBuilderAPI_Copy(shape, False, True)  # UnifySameDomain edits its input in place
    unify = ShapeUpgrade_UnifySameDomain(copy.Shape(), True, True, True)
    unify.Build()
    result = unify.Shape()
    if result.IsNull() or not BRepCheck_Analyzer(result).IsValid():
        raise OperationError("Operation produced invalid geometry")
    return OpResult(result, [], unified=True)


def _combine(shape: TopoDS_Shape, tool: TopoDS_Shape, fuse: bool) -> TopoDS_Shape:
    operation = _boolean(shape, tool, fuse, glue=False)
    if operation is None:
        raise OperationError("Boolean operation failed")
    return operation.Shape()


def _add_material(shape: TopoDS_Shape, solid: TopoDS_Shape, separate: bool) -> TopoDS_Shape:
    """Add a solid to the model: kept as its own body (`separate`) or fused into the bodies it touches."""
    if not separate:
        return _combine(shape, solid, fuse=True)
    compound, builder = TopoDS_Compound(), BRep_Builder()
    builder.MakeCompound(compound)
    for body in solids_of(shape):
        builder.Add(compound, body)
    builder.Add(compound, solid)
    return compound


def _new_body(values: dict) -> bool:
    return values.get("new_body", 0.0) >= 0.5


NEW_BODY = Param("new_body", "number", 1)  # 1 keeps the new solid as its own body, 0 joins it to the model


def _volume(shape: TopoDS_Shape) -> float:
    props = GProp_GProps()
    BRepGProp.VolumeProperties_s(shape, props)
    return props.Mass()


def _bounds_diagonal(shape: TopoDS_Shape) -> float:
    box = Bnd_Box()
    BRepBndLib.Add_s(shape, box)
    lo, hi = box.CornerMin(), box.CornerMax()
    return math.dist((lo.X(), lo.Y(), lo.Z()), (hi.X(), hi.Y(), hi.Z()))


def _cylinder(origin: gp_Pnt, direction: gp_Dir, radius: float, length: float) -> TopoDS_Shape:
    return BRepPrimAPI_MakeCylinder(gp_Ax2(origin, direction), radius, length).Shape()


def _moved(shape: TopoDS_Shape, offset: gp_Vec) -> TopoDS_Shape:
    transform = gp_Trsf()
    transform.SetTranslation(offset)
    return BRepBuilderAPI_Transform(shape, transform, True).Shape()


class Hole:
    """A cylindrical face read as a hole: where its axis starts, which way it runs, its radius and length."""

    def __init__(self, face):
        surface = BRepAdaptor_Surface(face)
        if surface.GetType() != GeomAbs_Cylinder:
            raise OperationError("Select the cylindrical wall of a hole")
        cylinder = surface.Cylinder()
        u0, u1, v0, v1 = BRepTools.UVBounds_s(face)
        if u1 - u0 < 2 * math.pi - 1e-6:
            raise OperationError("That cylinder face is only partly round (a fillet?); select a full hole wall")
        axis = cylinder.Axis()
        self.direction = axis.Direction()
        self.origin = axis.Location().Translated(gp_Vec(self.direction).Multiplied(v0))
        self.radius = cylinder.Radius()
        self.length = v1 - v0
        # The face's outward (material) normal points away from the axis for a boss, toward it for a hole.
        self.boss = face.Orientation() != TopAbs_REVERSED

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


def _compound(shapes: list[TopoDS_Shape]) -> TopoDS_Shape:
    compound = TopoDS_Compound()
    builder = BRep_Builder()
    builder.MakeCompound(compound)
    for shape in shapes:
        builder.Add(compound, shape)
    return compound


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
    return [Hole(topology.face(i)) for i in selection.faces]


class _CylinderFaces(Tool):
    def applies(self, topology, selection):
        return all(BRepAdaptor_Surface(topology.face(i)).GetType() == GeomAbs_Cylinder for i in selection.faces)


@register
class DeleteFace(Tool):
    """Remove faces and heal: the neighbours are extended until they meet."""

    id = "delete_face"
    label = "Delete face"
    description = "Removes the selected faces and heals the gap by extending the neighbouring faces. Select one or more faces."
    accepts = Accepts(faces=(1, None))

    def run(self, topology, selection, values, preview):
        return _defeature(topology, selection, "delete these faces")


@register
class RemoveRound(Tool):
    """Remove fillets or chamfers by deleting their faces; the adjacent faces extend back to a sharp edge."""

    id = "remove_round"
    label = "Remove fillet/chamfer"
    description = "Takes away a rounded or beveled edge and restores the sharp corner. Select the rounded or beveled face."
    accepts = Accepts(faces=(1, None))

    def run(self, topology, selection, values, preview):
        return _defeature(topology, selection, "remove this fillet or chamfer")


def _defeature(topology, selection, what: str) -> OpResult:
    operation = BRepAlgoAPI_Defeaturing()
    operation.SetShape(topology.shape)
    for i in selection.faces:
        operation.AddFaceToRemove(topology.face(i))
    operation.SetRunParallel(True)
    operation.Build()
    if not operation.IsDone() or operation.Shape().IsNull():
        raise OperationError(f"Could not {what}: the neighbouring faces cannot be extended to close the gap")
    return finish(operation.Shape())


@register
class FillHole(_CylinderFaces):
    id = "fill_hole"
    label = "Fill hole / remove boss"
    description = "Fills a hole with material, or cuts a boss back flush. Select the round face of the hole or boss."
    related = ("equal_radius",)
    accepts = Accepts(faces=(1, None))

    def run(self, topology, selection, values, preview):
        return finish(apply_holes(topology.shape, _holes(topology, selection)))


@register
class ResizeHole(_CylinderFaces):
    """Change a hole's diameter, keeping its axis and depth. A diameter of 0 leaves it unchanged."""

    id = "resize_hole"
    label = "Resize hole / boss"
    description = "Changes the diameter of a hole or boss, keeping its axis and depth. Select its round face; a diameter of 0 leaves it unchanged."
    related = ("equal_radius",)
    accepts = Accepts(faces=(1, None))
    params = [Param("diameter", "length", 0.0)]

    def run(self, topology, selection, values, preview):
        diameter = values["diameter"]
        if diameter < 0:
            raise OperationError("The diameter can't be negative")
        shape = topology.shape
        if diameter < MIN_DISTANCE:
            return OpResult(shape, [topology.face(i) for i in selection.faces])
        holes = _holes(topology, selection)
        return finish(apply_holes(shape, holes, [(diameter / 2, None)] * len(holes)))


@register
class MoveHole(_CylinderFaces):
    id = "move_hole"
    label = "Move hole / boss"
    description = "Moves a hole or boss by the given distances along X, Y and Z. Select its round face."
    related = ("equal_radius",)
    accepts = Accepts(faces=(1, None))
    params = [Param("dx", "length"), Param("dy", "length"), Param("dz", "length")]

    def run(self, topology, selection, values, preview):
        offset = gp_Vec(values["dx"], values["dy"], values["dz"])
        shape = topology.shape
        if offset.Magnitude() < MIN_DISTANCE:
            return OpResult(shape, [topology.face(i) for i in selection.faces])
        holes = _holes(topology, selection)
        return finish(apply_holes(shape, holes, [(None, offset)] * len(holes)))


@register
class PatternHole(_CylinderFaces):
    """Copies of a hole at a fixed spacing (a linear pattern): `count` holes in total."""

    id = "pattern_hole"
    label = "Pattern hole / boss"
    description = "Makes copies of a hole or boss in a straight line. Select its round face, then set the total count and the step between copies along X, Y and Z."
    accepts = Accepts(faces=(1, 1))
    params = [Param("count", "number", 3), Param("dx", "length", 10), Param("dy", "length"), Param("dz", "length")]

    def run(self, topology, selection, values, preview):
        count = int(round(values["count"]))
        if not 1 <= count <= 200:
            raise OperationError("The count must be between 1 and 200")
        step = gp_Vec(values["dx"], values["dy"], values["dz"])
        if count > 1 and step.Magnitude() < MIN_DISTANCE:
            raise OperationError("Give a spacing for the pattern")
        (hole,) = _holes(topology, selection)
        shape = topology.shape
        for i in range(1, count):
            shape = hole.place(shape, offset=step.Multiplied(i))
        return finish(shape)


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


def _plane_axes(face) -> tuple[gp_Pnt, gp_Dir, gp_Dir, gp_Dir]:
    """Centre of a planar face, its outward normal and two in-plane directions."""
    normal = planar_normal(face)
    if normal is None:
        raise OperationError("Select a flat face")
    props = GProp_GProps()
    BRepGProp.SurfaceProperties_s(face, props)
    plane = BRepAdaptor_Surface(face).Plane()
    return props.CentreOfMass(), normal, plane.XAxis().Direction(), plane.YAxis().Direction()


class _PlanarFace(Tool):
    def applies(self, topology, selection):
        return all(planar_normal(topology.face(i)) is not None for i in selection.faces)


class _HoleOnFace(_PlanarFace):
    """Shared placement for holes cut into a flat face: positioned from the face centre, running inward."""

    accepts = Accepts(faces=(1, 1))
    params = [Param("diameter", "length", 6), Param("depth", "length"), Param("offset_u", "length"), Param("offset_v", "length")]

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
        return finish(shape)


@register
class AddHole(_HoleOnFace):
    """A round hole into a flat face, positioned from the face centre; depth 0 cuts all the way through."""

    id = "add_hole"
    label = "Add hole"
    description = "Drills a round hole into a flat face, placed from the face centre. Select one flat face; depth 0 = through."


@register
class AddCounterbore(_HoleOnFace):
    """A hole with a wider, flat-bottomed recess at the top (for socket-head screws)."""

    id = "add_counterbore"
    label = "Add counterbore"
    description = "Drills a stepped hole with a wider, flat-bottomed top part for a screw head. Select one flat face; depth 0 = through."
    params = _HoleOnFace.params + [Param("bore_diameter", "length", 11), Param("bore_depth", "length", 4)]

    def extra_cutters(self, start, normal, values, depth, margin):
        if values["bore_diameter"] <= values["diameter"] or values["bore_depth"] < MIN_DISTANCE:
            raise OperationError("The counterbore must be wider than the hole and have a depth")
        lead = start.Translated(gp_Vec(normal).Multiplied(margin))
        return [_cylinder(lead, normal.Reversed(), values["bore_diameter"] / 2, values["bore_depth"] + margin)]


@register
class AddCountersink(_HoleOnFace):
    """A hole with a conical recess at the top (for flat-head screws); the cone angle is the full included angle."""

    id = "add_countersink"
    label = "Add countersink"
    description = "Drills a hole with a cone-shaped opening for a flat-head screw. Select one flat face; depth 0 = through."
    params = _HoleOnFace.params + [Param("sink_diameter", "length", 12), Param("sink_angle", "angle", 90)]

    def extra_cutters(self, start, normal, values, depth, margin):
        if values["sink_diameter"] <= values["diameter"] or not 10 <= values["sink_angle"] <= 170:
            raise OperationError("The countersink must be wider than the hole, with an angle between 10 and 170 degrees")
        half = math.radians(values["sink_angle"]) / 2
        r_top, r_bottom = values["sink_diameter"] / 2, values["diameter"] / 2
        height = (r_top - r_bottom) / math.tan(half)
        # Cone from the hole's radius at depth `height` up to the sink radius at the face, extended by the margin.
        r_lead = r_top + margin * math.tan(half)
        base = start.Translated(gp_Vec(normal).Multiplied(-height))
        return [BRepPrimAPI_MakeCone(gp_Ax2(base, normal), r_bottom, r_lead, height + margin).Shape()]


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


@register
class AlignHoles(_HoleGroup):
    """Match the position of every selected hole to the first selected one along an axis (Figma-style align)."""

    id = "align_holes"
    label = "Align holes / bosses"
    description = "Lines up holes or bosses so their centres match the first one you selected, along the chosen axis (0 = X, 1 = Y, 2 = Z). Select two or more round faces."
    accepts = Accepts(faces=(2, None))
    params = [Param("axis", "number", 0)]

    def run(self, topology, selection, values, preview):
        axis = self._axis(values)
        holes = _holes(topology, selection)
        reference = self._centre(holes[0], axis)
        return self._shift(topology, holes, [reference - self._centre(h, axis) for h in holes], axis)


@register
class DistributeHoles(_HoleGroup):
    """Space the selected holes evenly along an axis between the two outermost ones."""

    id = "distribute_holes"
    label = "Distribute holes / bosses"
    description = "Spaces holes or bosses evenly between the two outermost ones, along the chosen axis (0 = X, 1 = Y, 2 = Z). Select three or more round faces."
    accepts = Accepts(faces=(3, None))
    params = [Param("axis", "number", 0)]

    def run(self, topology, selection, values, preview):
        axis = self._axis(values)
        holes = _holes(topology, selection)
        centres = [self._centre(h, axis) for h in holes]
        order = sorted(range(len(holes)), key=lambda i: centres[i])
        first, last = centres[order[0]], centres[order[-1]]
        deltas = [0.0] * len(holes)
        for rank, i in enumerate(order):
            deltas[i] = first + (last - first) * rank / (len(holes) - 1) - centres[i]
        return self._shift(topology, holes, deltas, axis)


@register
class AddBoss(_PlanarFace):
    """A round boss standing out of a flat face, positioned from the face centre."""

    id = "add_boss"
    label = "Add boss"
    description = "Adds a round post standing on a flat face, placed from the face centre. Select one flat face."
    accepts = Accepts(faces=(1, 1))
    params = [Param("diameter", "length", 10), Param("height", "length", 5), Param("offset_u", "length"), Param("offset_v", "length")]

    def run(self, topology, selection, values, preview):
        if values["diameter"] < MIN_DISTANCE or values["height"] < MIN_DISTANCE:
            raise OperationError("The diameter and height must be positive")
        centre, normal, u, v = _plane_axes(topology.face(selection.faces[0]))
        start = centre.Translated(gp_Vec(u).Multiplied(values["offset_u"])).Translated(gp_Vec(v).Multiplied(values["offset_v"]))
        # Start a little inside the solid so the boss fuses cleanly with the face.
        sunk = start.Translated(gp_Vec(normal).Multiplied(-1e-3))
        boss = _cylinder(sunk, normal, values["diameter"] / 2, values["height"] + 1e-3)
        return finish(_combine(topology.shape, boss, fuse=True))


@register
class AddSlot(_PlanarFace):
    """A slot (rounded-end rectangle) cut into a flat face. `length` is end to end, `angle` turns it about the
    face normal from the face's first in-plane direction; depth 0 cuts all the way through."""

    id = "add_slot"
    label = "Add slot"
    description = "Cuts a slot with rounded ends into a flat face, placed from the face centre. Select one flat face; angle turns the slot."
    accepts = Accepts(faces=(1, 1))
    params = [
        Param("length", "length", 20),
        Param("width", "length", 6),
        Param("depth", "length"),
        Param("angle", "angle"),
        Param("offset_u", "length"),
        Param("offset_v", "length"),
    ]

    def run(self, topology, selection, values, preview):
        length, width = values["length"], values["width"]
        if width < MIN_DISTANCE or length < width:
            raise OperationError("The slot needs a positive width and a length at least as large")
        centre, normal, u, v = _plane_axes(topology.face(selection.faces[0]))
        centre = centre.Translated(gp_Vec(u).Multiplied(values["offset_u"])).Translated(gp_Vec(v).Multiplied(values["offset_v"]))
        angle = math.radians(values["angle"])
        along = gp_Vec(u).Multiplied(math.cos(angle)).Added(gp_Vec(v).Multiplied(math.sin(angle)))
        along_dir = gp_Dir(along)
        down = normal.Reversed()
        depth = values["depth"] if values["depth"] > MIN_DISTANCE else _bounds_diagonal(topology.shape)
        margin = 0.01 * depth + 1e-3
        lead = centre.Translated(gp_Vec(normal).Multiplied(margin))
        straight = length - width
        axes = gp_Ax2(lead, down, along_dir)  # local X along the slot, local Y = down x X
        side = gp_Vec(axes.YDirection())
        corner = lead.Translated(gp_Vec(along_dir).Multiplied(-straight / 2)).Translated(side.Multiplied(-width / 2))
        parts = [BRepPrimAPI_MakeBox(gp_Ax2(corner, down, along_dir), straight, width, depth + margin).Shape()] if straight > MIN_DISTANCE else []
        for sign in (-1, 1):
            end = lead.Translated(gp_Vec(along_dir).Multiplied(sign * straight / 2))
            parts.append(_cylinder(end, down, width / 2, depth + margin))
        shape = topology.shape
        for part in parts:
            shape = _combine(shape, part, fuse=False)
        return finish(shape)


def _plane_offset(face, normal: gp_Dir) -> float:
    return gp_Vec(gp_Pnt(0, 0, 0), BRepAdaptor_Surface(face).Plane().Location()).Dot(gp_Vec(normal))


def _opposite_flat(topology, flat, hole: "Hole"):
    """The nearest flat face of the same solid that faces `flat` across the hole (parallel, opposite outward
    normal, on the inner side, and covering the hole's middle), or None."""
    normal = planar_normal(flat)
    middle = hole.origin.Translated(gp_Vec(hole.direction).Multiplied(hole.length / 2))
    here = _plane_offset(flat, normal)
    best = None
    for _, face in topology.faces():
        other = planar_normal(face)
        if other is None or face.IsSame(flat) or other.Dot(normal) > -1 + 1e-6:
            continue
        gap = here - _plane_offset(face, other.Reversed())  # distance from `flat` inward to this face
        if gap < MIN_DISTANCE:
            continue
        box = Bnd_Box()
        BRepBndLib.Add_s(face, box)
        lo, hi = box.CornerMin(), box.CornerMax()
        inside = all(
            low - 1e-6 <= c <= high + 1e-6
            for c, low, high, along in zip(
                (middle.X(), middle.Y(), middle.Z()), (lo.X(), lo.Y(), lo.Z()), (hi.X(), hi.Y(), hi.Z()), (abs(normal.X()), abs(normal.Y()), abs(normal.Z()))
            )
            if along < 1 - 1e-6
        )
        if inside and (best is None or gap < best[0]):
            best = (gap, face)
    return best[1] if best else None


@register
class CenterBetween(Tool):
    """Centre a hole or boss between two parallel flat faces; the three faces can be picked in any order. With only
    one flat face picked, the nearest flat face facing it across the hole is used (so only one side needs to be seen)."""

    id = "center_between"
    label = "Center between faces"
    description = "Centers a hole or boss between two parallel flat faces. Select the round face and the two flat faces, in any order; or the round face and one flat face, and the opposite side is found for you."
    accepts = Accepts(faces=(2, 3))

    @staticmethod
    def _sorted(topology, selection):
        """(hole, flat, flat or None) from the picked faces: one cylinder plus one or two planes, or None."""
        faces = [topology.face(i) for i in selection.faces]
        holes = [f for f in faces if BRepAdaptor_Surface(f).GetType() == GeomAbs_Cylinder]
        flats = [f for f in faces if planar_normal(f) is not None]
        if len(holes) != 1 or len(flats) != len(faces) - 1:
            return None
        return holes[0], flats[0], (flats[1] if len(flats) == 2 else None)

    def applies(self, topology, selection):
        found = self._sorted(topology, selection)
        if found is None:
            return False
        if found[2] is None:
            return True
        na, nb = planar_normal(found[1]), planar_normal(found[2])
        return abs(na.Dot(nb)) > 1 - 1e-6

    def run(self, topology, selection, values, preview):
        found = self._sorted(topology, selection)
        if found is None:
            raise OperationError("Select one hole or boss and one or two flat faces")
        hole_face, a, b = found
        hole = Hole(hole_face)
        if b is None:
            b = _opposite_flat(topology, a, hole)
            if b is None:
                raise OperationError("No flat face faces that one across the hole; pick the second face yourself")
        normal = planar_normal(a)
        axis_along = abs(hole.direction.Dot(normal))
        if axis_along > 1 - 1e-6:
            raise OperationError("The hole runs along the faces' normal, so it cannot be centred between them")
        offsets = [_plane_offset(f, normal) for f in (a, b)]
        middle = hole.origin.Translated(gp_Vec(hole.direction).Multiplied(hole.length / 2))
        here = gp_Vec(gp_Pnt(0, 0, 0), middle).Dot(gp_Vec(normal))
        delta = (offsets[0] + offsets[1]) / 2 - here
        if abs(delta) < MIN_DISTANCE:
            return OpResult(topology.shape, [])
        move = gp_Vec(normal).Multiplied(delta)
        return finish(apply_holes(topology.shape, [hole], [(None, move)]))


# Solids ----------------------------------------------------------------------------------------------


@register
class AddBox(Tool):
    """A box added as a new body (new_body 0 joins it to the model), given by its minimum corner and size."""

    id = "add_box"
    label = "Add box"
    description = "Adds a box, given by its corner and size. Nothing needs to be selected; new_body 1 keeps it separate, 0 joins it to the model."
    placement = ("x", "y", "z")
    accepts = Accepts()
    params = [
        Param("width", "length", 10),
        Param("depth", "length", 10),
        Param("height", "length", 10),
        Param("x", "length"),
        Param("y", "length"),
        Param("z", "length"),
        NEW_BODY,
    ]

    def run(self, topology, selection, values, preview):
        if min(values["width"], values["depth"], values["height"]) < MIN_DISTANCE:
            raise OperationError("The box sizes must be positive")
        box = BRepPrimAPI_MakeBox(gp_Pnt(values["x"], values["y"], values["z"]), values["width"], values["depth"], values["height"]).Shape()
        return finish(_add_material(topology.shape, box, _new_body(values)))


@register
class AddCylinder(Tool):
    """A cylinder standing on the XY plane at (x, y, z), joined to the model."""

    id = "add_cylinder"
    label = "Add cylinder"
    description = "Adds a cylinder standing on the XY plane at the given position. Nothing needs to be selected; new_body 1 keeps it separate, 0 joins it to the model."
    placement = ("x", "y", "z")
    accepts = Accepts()
    params = [Param("diameter", "length", 10), Param("height", "length", 10), Param("x", "length"), Param("y", "length"), Param("z", "length"), NEW_BODY]

    def run(self, topology, selection, values, preview):
        if min(values["diameter"], values["height"]) < MIN_DISTANCE:
            raise OperationError("The cylinder sizes must be positive")
        cylinder = _cylinder(gp_Pnt(values["x"], values["y"], values["z"]), gp_Dir(0, 0, 1), values["diameter"] / 2, values["height"])
        return finish(_add_material(topology.shape, cylinder, _new_body(values)))


@register
class Shell(Tool):
    """Hollow the solid, leaving the selected faces open; the wall thickness grows inward."""

    id = "shell"
    label = "Shell"
    description = "Hollows out the solid, leaving the selected faces open. Select the faces to open; the wall thickness grows inward."
    accepts = Accepts(faces=(1, None))
    params = [Param("thickness", "length", 2)]

    def run(self, topology, selection, values, preview):
        thickness = values["thickness"]
        if thickness < MIN_DISTANCE:
            raise OperationError("The wall thickness must be positive")
        openings = List_TopoDS_Shape()
        for i in selection.faces:
            openings.Append(topology.face(i))
        maker = BRepOffsetAPI_MakeThickSolid()
        try:
            maker.MakeThickSolidByJoin(topology.shape, openings, -thickness, TOL)
            maker.Build()
        except Exception as e:  # OCCT raises Standard_Failure for walls that do not fit
            raise OperationError(f"Could not shell with this thickness: {e}") from None
        if not maker.IsDone() or maker.Shape().IsNull():
            raise OperationError("Could not shell with this thickness")
        result = finish(maker.Shape())
        if _volume(result.shape) >= _volume(topology.shape) - 1e-6:
            raise OperationError("Could not shell with this thickness (the walls would not fit)")
        return result


@register
class Mirror(_PlanarFace):
    """Mirror the whole model across the plane of the selected flat face and join the copy."""

    id = "mirror"
    label = "Mirror"
    description = "Mirrors the whole model across the plane of a flat face and joins the copy. Select one flat face; offset moves the mirror plane."
    accepts = Accepts(faces=(1, 1))
    params = [Param("offset", "length")]

    def run(self, topology, selection, values, preview):
        centre, normal, _, _ = _plane_axes(topology.face(selection.faces[0]))
        centre = centre.Translated(gp_Vec(normal).Multiplied(values["offset"]))
        transform = gp_Trsf()
        transform.SetMirror(gp_Ax2(centre, normal))
        mirrored = BRepBuilderAPI_Transform(topology.shape, transform, True).Shape()
        return finish(_combine(topology.shape, mirrored, fuse=True))


def _faces_of(shape):
    from OCP.TopAbs import TopAbs_FACE

    explorer = _Explorer(shape, TopAbs_FACE)
    while explorer.More():
        yield TopoDS.Face(explorer.Current())
        explorer.Next()


def _children(compound: TopoDS_Shape):
    from OCP.TopoDS import TopoDS_Iterator

    it = TopoDS_Iterator(compound)
    while it.More():
        yield it.Value()
        it.Next()


def _sew_into(shape: TopoDS_Shape, face: TopoDS_Shape) -> OpResult:
    """Sew a new face onto a model; if that closes a shell the result becomes a solid."""
    # Sewing edits the shapes it is given (tolerances), and the new face shares edges with the model: sew a deep copy of both.
    pair, builder = TopoDS_Compound(), BRep_Builder()
    builder.MakeCompound(pair)
    builder.Add(pair, shape)
    builder.Add(pair, face)
    parts = list(_children(BRepBuilderAPI_Copy(pair, True, False).Shape()))
    sewing = BRepBuilderAPI_Sewing(1e-4)
    for part in parts:
        sewing.Add(part)
    sewing.Perform()
    result = sewing.SewedShape()
    shells = _Explorer(result, TopAbs_SHELL)
    if shells.More() and not result.IsNull():
        shell = TopoDS.Shell(shells.Current())
        if BRepCheck_Analyzer(shell).IsValid():
            solid = BRepBuilderAPI_MakeSolid(shell).Solid()
            if BRepCheck_Analyzer(solid).IsValid() and _volume(solid) > 0:
                return finish(solid)
    if result.IsNull() or not BRepCheck_Analyzer(result).IsValid():
        raise OperationError("Operation produced invalid geometry")
    return OpResult(result, [])


@register
class PatchFill(Tool):
    """Close a boundary of selected edges with a filled surface patch (continuity 0 = touching, 1 = tangent to the neighbouring faces).
    Seals the patch to the model; if that closes a shell the result becomes a solid."""

    id = "patch_fill"
    label = "Patch fill"
    description = "Closes a gap bounded by selected edges with a smooth filled surface. Select three or more edges; continuity 1 = tangent to neighbours, 0 = just touching."
    accepts = Accepts(edges=(3, None))
    params = [Param("continuity", "number", 1)]

    def run(self, topology, selection, values, preview):
        fill = None
        # Tangent patches fail where the neighbouring faces cannot be matched (e.g. a sharp box corner): retry touching only.
        for tangent in ([True, False] if values["continuity"] >= 0.5 else [False]):
            candidate = BRepFill_Filling()
            for edge_id in selection.edges:
                edge = topology.edge(edge_id)
                faces = topology.edge_faces(edge)
                if tangent and len(faces) == 1:
                    candidate.Add(edge, faces[0], GeomAbs_G1)
                else:
                    candidate.Add(edge, GeomAbs_C0)
            try:
                candidate.Build()
            except Exception:
                continue
            fill = candidate
            break
        if fill is None:
            raise OperationError("The edges do not form a boundary a patch can fill")
        if not fill.IsDone():
            raise OperationError("The patch could not be built from these edges")
        return _sew_into(topology.shape, fill.Face())


@register
class Bridge(Tool):
    """Join two edges with a ruled surface (continuity 0), sewn to the model; a closed result becomes a solid."""

    id = "bridge"
    label = "Bridge edges"
    description = "Joins two edges with a straight-ruled surface. Select two edges."
    accepts = Accepts(edges=(2, 2))
    params = []

    def run(self, topology, selection, values, preview):
        # BRepFill.Face_s corrupts later OpenCASCADE fillets in the same process (spike 2026-10-17); a ruled ThruSections shell does not.
        from OCP.BRepBuilderAPI import BRepBuilderAPI_MakeWire
        from OCP.BRepOffsetAPI import BRepOffsetAPI_ThruSections

        loft = BRepOffsetAPI_ThruSections(False, True)
        for edge_id in selection.edges:
            loft.AddWire(BRepBuilderAPI_MakeWire(topology.edge(edge_id)).Wire())
        try:
            loft.Build()
        except Exception as error:
            raise OperationError("These edges cannot be bridged") from error
        face = next(_faces_of(loft.Shape()), None)
        if face is None:
            raise OperationError("These edges cannot be bridged")
        return _sew_into(topology.shape, face)


@register
class Unify(Tool):
    """Merge coplanar and co-cylindrical faces (and the edges between them) across the whole model, e.g. after importing a split-up STEP file."""

    id = "unify"
    label = "Unify faces"
    description = "Merges neighbouring faces that lie on the same surface, for example after opening a file made of many small faces. Nothing needs to be selected."
    accepts = Accepts()
    params = []

    def run(self, topology, selection, values, preview):
        return finish(topology.shape)


@register
class Draft(_PlanarFace):
    """Tilt flat faces by an angle about the lowest point of the model along the pull direction (default Z)."""

    id = "draft"
    label = "Draft"
    description = "Tilts flat faces by an angle so they release from a mold, pivoting about the lowest point along the pull direction (default Z). Select one or more flat faces."
    accepts = Accepts(faces=(1, None))
    params = [Param("angle", "angle", 3), Param("pull_x", "number"), Param("pull_y", "number"), Param("pull_z", "number", 1)]

    def run(self, topology, selection, values, preview):
        pull = gp_Vec(values["pull_x"], values["pull_y"], values["pull_z"])
        if pull.Magnitude() < TOL:
            raise OperationError("Give a pull direction")
        direction = gp_Dir(pull)
        box = Bnd_Box()
        BRepBndLib.Add_s(topology.shape, box)
        lo, hi = box.CornerMin(), box.CornerMax()
        corners = [gp_Pnt(x, y, z) for x in (lo.X(), hi.X()) for y in (lo.Y(), hi.Y()) for z in (lo.Z(), hi.Z())]
        base = min(corners, key=lambda p: gp_Vec(p.XYZ()).Dot(gp_Vec(direction)))
        neutral = gp_Pln(base, direction)
        maker = BRepOffsetAPI_DraftAngle(topology.shape)
        for i in selection.faces:
            maker.Add(topology.face(i), direction, math.radians(values["angle"]), neutral)
            if not maker.AddDone():
                raise OperationError("Could not draft face (it may be parallel to the pull direction)")
        maker.Build()
        if not maker.IsDone() or maker.Shape().IsNull():
            raise OperationError("Could not draft these faces at this angle")
        return finish(maker.Shape())


@register
class AlignFace(_PlanarFace):
    """Move the first selected flat face until it is flush with the second (parallel faces only)."""

    id = "align_face"
    label = "Align face"
    description = "Moves the first selected flat face until it is flush with the second. Select two parallel flat faces, the one to move first."
    accepts = Accepts(faces=(2, 2))
    params = [Param("offset", "length")]

    def run(self, topology, selection, values, preview):
        moving, target = (topology.face(i) for i in selection.faces)
        point, normal, _, _ = _plane_axes(moving)
        goal, goal_normal, _, _ = _plane_axes(target)
        if abs(normal.Dot(goal_normal)) < 1 - 1e-6:
            raise OperationError("The two faces must be parallel")
        distance = gp_Vec(point, goal).Dot(gp_Vec(normal)) + values["offset"]
        return push_pull(topology.shape, moving, distance, preview=preview)


# Whole-body transforms and more primitives -----------------------------------------------------------------


def _on_bodies(topology, selection, change) -> TopoDS_Shape:
    """Apply `change` (shape -> shape) to the solids that contain the selected faces; with no selection, to the whole model."""
    if not selection.faces:
        return change(topology.shape)
    chosen = []
    for i in selection.faces:
        face = topology.face(i)
        for solid in solids_of(topology.shape):
            if any(f.IsSame(face) for f in _faces_of(solid)) and not any(solid.IsSame(c) for c in chosen):
                chosen.append(solid)
    if not chosen:
        raise OperationError("The selected faces do not belong to a solid")
    compound, builder = TopoDS_Compound(), BRep_Builder()
    builder.MakeCompound(compound)
    for solid in solids_of(topology.shape):
        builder.Add(compound, change(solid) if any(solid.IsSame(c) for c in chosen) else solid)
    return compound


def _faces_of(shape):
    explorer = _Explorer(shape, TopAbs_FACE)
    while explorer.More():
        yield explorer.Current()
        explorer.Next()


@register
class MoveBody(Tool):
    """Move the solids containing the selected faces (the whole model when nothing is selected) by a vector."""

    id = "move_body"
    label = "Move body"
    description = "Moves a whole solid by the given distances along X, Y and Z. Select any face of the solid, or nothing to move the whole model."
    accepts = Accepts(faces=(0, None))
    params = [Param("dx", "length"), Param("dy", "length"), Param("dz", "length")]

    def run(self, topology, selection, values, preview):
        offset = gp_Vec(values["dx"], values["dy"], values["dz"])
        if offset.Magnitude() < MIN_DISTANCE:
            return OpResult(topology.shape, [])
        return finish(_on_bodies(topology, selection, lambda shape: _moved(shape, offset)))


@register
class RotateBody(Tool):
    """Rotate the selected solids (the whole model when nothing is selected) about an axis through the origin (axis: 0 = X, 1 = Y, 2 = Z)."""

    id = "rotate_body"
    label = "Rotate body"
    description = "Rotates a whole solid about the X, Y or Z axis through the origin (0 = X, 1 = Y, 2 = Z). Select any face of the solid, or nothing for the whole model."
    accepts = Accepts(faces=(0, None))
    params = [Param("axis", "number", 2), Param("angle", "angle", 90)]

    def run(self, topology, selection, values, preview):
        axis = int(round(values["axis"]))
        if axis not in (0, 1, 2):
            raise OperationError("The axis must be 0 (X), 1 (Y) or 2 (Z)")
        direction = gp_Dir(*(1.0 if k == axis else 0.0 for k in range(3)))
        transform = gp_Trsf()
        transform.SetRotation(gp_Ax1(gp_Pnt(0, 0, 0), direction), math.radians(values["angle"]))
        return finish(_on_bodies(topology, selection, lambda shape: BRepBuilderAPI_Transform(shape, transform, True).Shape()))


@register
class ScaleBody(Tool):
    """Scale the selected solids (the whole model when nothing is selected) uniformly about the origin."""

    id = "scale_body"
    label = "Scale body"
    description = "Scales a whole solid evenly about the origin. Select any face of the solid, or nothing for the whole model; 2 doubles the size."
    accepts = Accepts(faces=(0, None))
    params = [Param("factor", "number", 1)]

    def run(self, topology, selection, values, preview):
        factor = values["factor"]
        if factor < 1e-3 or factor > 1e3:
            raise OperationError("The scale factor must be between 0.001 and 1000")
        transform = gp_Trsf()
        transform.SetScale(gp_Pnt(0, 0, 0), factor)
        return finish(_on_bodies(topology, selection, lambda shape: BRepBuilderAPI_Transform(shape, transform, True).Shape()))


@register
class AddSphere(Tool):
    id = "add_sphere"
    label = "Add sphere"
    description = "Adds a sphere at the given position. Nothing needs to be selected; new_body 1 keeps it separate, 0 joins it to the model."
    placement = ("x", "y", "z")
    accepts = Accepts()
    params = [Param("diameter", "length", 10), Param("x", "length"), Param("y", "length"), Param("z", "length"), NEW_BODY]

    def run(self, topology, selection, values, preview):
        if values["diameter"] < MIN_DISTANCE:
            raise OperationError("The diameter must be positive")
        sphere = BRepPrimAPI_MakeSphere(gp_Pnt(values["x"], values["y"], values["z"]), values["diameter"] / 2).Shape()
        return finish(_add_material(topology.shape, sphere, _new_body(values)))


@register
class AddCone(Tool):
    """A cone (or truncated cone) standing on the XY plane at (x, y, z)."""

    id = "add_cone"
    label = "Add cone"
    description = "Adds a cone or truncated cone (set a top diameter of 0 for a point) at the given position. Nothing needs to be selected; new_body 1 keeps it separate, 0 joins it to the model."
    placement = ("x", "y", "z")
    accepts = Accepts()
    params = [
        Param("bottom_diameter", "length", 10),
        Param("top_diameter", "length"),
        Param("height", "length", 10),
        Param("x", "length"),
        Param("y", "length"),
        Param("z", "length"),
        NEW_BODY,
    ]

    def run(self, topology, selection, values, preview):
        if values["bottom_diameter"] < 0 or values["top_diameter"] < 0 or values["bottom_diameter"] + values["top_diameter"] < MIN_DISTANCE or values["height"] < MIN_DISTANCE:
            raise OperationError("Give a positive height and at least one positive diameter")
        axes = gp_Ax2(gp_Pnt(values["x"], values["y"], values["z"]), gp_Dir(0, 0, 1))
        cone = BRepPrimAPI_MakeCone(axes, values["bottom_diameter"] / 2, values["top_diameter"] / 2, values["height"]).Shape()
        return finish(_add_material(topology.shape, cone, _new_body(values)))


@register
class AddTorus(Tool):
    """A torus lying on the XY plane, centred at (x, y, z). `major` is the ring's centre-line diameter."""

    id = "add_torus"
    label = "Add torus"
    description = "Adds a ring shape (donut) at the given position, from the ring radius and the tube radius. Nothing needs to be selected; new_body 1 keeps it separate, 0 joins it to the model."
    placement = ("x", "y", "z")
    accepts = Accepts()
    params = [Param("major", "length", 20), Param("minor", "length", 5), Param("x", "length"), Param("y", "length"), Param("z", "length"), NEW_BODY]

    def run(self, topology, selection, values, preview):
        if values["minor"] < MIN_DISTANCE or values["major"] <= values["minor"]:
            raise OperationError("The ring diameter must be larger than the tube diameter, and both positive")
        axes = gp_Ax2(gp_Pnt(values["x"], values["y"], values["z"]), gp_Dir(0, 0, 1))
        torus = BRepPrimAPI_MakeTorus(axes, values["major"] / 2, values["minor"] / 2).Shape()
        return finish(_add_material(topology.shape, torus, _new_body(values)))


MAX_ARRAY_COPIES = 200


def _array_copies(count: float) -> int:
    n = int(round(count))
    if n < 2 or n > MAX_ARRAY_COPIES:
        raise OperationError(f"The count must be between 2 and {MAX_ARRAY_COPIES}")
    return n


def _array_source(topology, selection) -> TopoDS_Shape:
    """What an array copies: the solids containing the selected faces, or the whole model with no faces selected."""
    if not selection.faces:
        return topology.shape
    chosen = []
    for i in selection.faces:
        face = topology.face(i)
        for solid in solids_of(topology.shape):
            if any(f.IsSame(face) for f in _faces_of(solid)) and not any(solid.IsSame(c) for c in chosen):
                chosen.append(solid)
    if not chosen:
        raise OperationError("The selected faces do not belong to a solid")
    return _compound(chosen)


def _fuse_copies(topology, selection, transforms: list[gp_Trsf]) -> OpResult:
    source = _array_source(topology, selection)
    result = topology.shape
    for trsf in transforms:
        result = _combine(result, BRepBuilderAPI_Transform(source, trsf, True).Shape(), fuse=True)
    return finish(result)


@register
class LinearArray(Tool):
    """Copies of the chosen body (the whole model when no face is selected) at equal steps (dx, dy, dz), fused with it. `count` includes the original."""

    id = "linear_array"
    label = "Linear array"
    description = "Makes copies of a body in a straight line and fuses them. Select any face of the body, or nothing for the whole model; the count includes the original."
    accepts = Accepts(faces=(0, None))
    params = [Param("count", "number", 3), Param("dx", "length", 20), Param("dy", "length"), Param("dz", "length")]

    def run(self, topology, selection, values, preview):
        count = _array_copies(values["count"])
        step = gp_Vec(values["dx"], values["dy"], values["dz"])
        if step.Magnitude() < MIN_DISTANCE:
            raise OperationError("Give a non-zero step")
        transforms = []
        for k in range(1, count):
            trsf = gp_Trsf()
            trsf.SetTranslation(step.Multiplied(k))
            transforms.append(trsf)
        return _fuse_copies(topology, selection, transforms)


@register
class CircularArray(Tool):
    """Copies of the chosen body (the whole model when no face is selected) rotated about an axis through the origin (0 = X, 1 = Y, 2 = Z), fused with it.
    `angle` is the total sweep; 360 spreads the copies evenly all the way round."""

    id = "circular_array"
    label = "Circular array"
    description = "Makes copies of a body (select any of its faces, or nothing for the whole model) around the X, Y or Z axis through the origin (0 = X, 1 = Y, 2 = Z) and fuses them. The count includes the original; 360 spreads them round a full circle."
    accepts = Accepts(faces=(0, None))
    params = [Param("count", "number", 4), Param("axis", "number", 2), Param("angle", "angle", 360)]

    def run(self, topology, selection, values, preview):
        count = _array_copies(values["count"])
        axis = int(round(values["axis"]))
        if axis not in (0, 1, 2):
            raise OperationError("The axis must be 0 (X), 1 (Y) or 2 (Z)")
        angle = values["angle"]
        if abs(angle) < 1e-6:
            raise OperationError("Give a non-zero angle")
        full = abs(abs(angle) - 360) < 1e-6
        step = angle / (count if full else count - 1)
        direction = gp_Dir(*(1.0 if k == axis else 0.0 for k in range(3)))
        transforms = []
        for k in range(1, count):
            trsf = gp_Trsf()
            trsf.SetRotation(gp_Ax1(gp_Pnt(0, 0, 0), direction), math.radians(step * k))
            transforms.append(trsf)
        return _fuse_copies(topology, selection, transforms)


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


def _chamfer_with_face(topology, selection, add) -> OpResult:
    """Chamfer the selected edges, measuring from the selected face, which every edge must border."""
    from OCP.BRepFilletAPI import BRepFilletAPI_MakeChamfer

    face = topology.face(selection.faces[0])
    maker = BRepFilletAPI_MakeChamfer(topology.shape)
    edges = [topology.edge(i) for i in selection.edges]
    for edge in edges:
        if not any(f.IsSame(face) for f in topology.edge_faces(edge)):
            raise OperationError("Every edge must border the selected reference face")
        add(maker, edge, face)
    try:
        maker.Build()
    except Exception as e:  # OCCT raises Standard_Failure for impossible sizes
        raise OperationError(f"Could not chamfer: {e}") from None
    if not maker.IsDone() or maker.Shape().IsNull() or not BRepCheck_Analyzer(maker.Shape()).IsValid():
        raise OperationError("Could not chamfer these edges at this size")
    generated = [g for edge in edges for g in maker.Generated(edge)]
    return OpResult(maker.Shape(), generated)


@register
class ChamferTwoDistances(Tool):
    """Chamfer edges with different leg lengths: `first` along the selected reference face, `second` on the other."""

    id = "chamfer_two_distances"
    label = "Chamfer (two distances)"
    description = "Bevels edges with a different distance on each side. Select one face (it sets which side is first) and one or more of its edges."
    accepts = Accepts(faces=(1, 1), edges=(1, None))
    params = [Param("first", "length", 2), Param("second", "length", 1), Param("swap", "number", 0)]  # swap 1 puts `first` on the other side

    def run(self, topology, selection, values, preview):
        if values["first"] < MIN_DISTANCE or values["second"] < MIN_DISTANCE:
            raise OperationError("Both distances must be positive")
        first, second = (values["second"], values["first"]) if values["swap"] >= 0.5 else (values["first"], values["second"])
        return _chamfer_with_face(topology, selection, lambda m, e, f: m.Add(first, second, e, f))


@register
class ChamferDistanceAngle(Tool):
    """Chamfer edges by a distance along the selected reference face and the angle the bevel makes with it."""

    id = "chamfer_distance_angle"
    label = "Chamfer (distance and angle)"
    description = "Bevels edges with a distance on one face and an angle. Select one face (it sets the side the distance is measured on) and one or more of its edges."
    accepts = Accepts(faces=(1, 1), edges=(1, None))
    params = [Param("distance", "length", 2), Param("angle", "angle", 45)]

    def run(self, topology, selection, values, preview):
        if values["distance"] < MIN_DISTANCE or not 0 < values["angle"] < 90:
            raise OperationError("Give a positive distance and an angle between 0 and 90 degrees")
        return _chamfer_with_face(topology, selection, lambda m, e, f: m.AddDA(values["distance"], math.radians(values["angle"]), e, f))


@register
class BodyBoolean(Tool):
    """Boolean between two solids of the model. Select a face of the first (target) solid, then a face of the second
    (tool) solid. `mode` 0 unites them, 1 subtracts the tool from the target, 2 keeps only the overlap.
    Other solids stay as they are."""

    id = "body_boolean"
    label = "Combine bodies"
    description = "Combines two solids: mode 0 unites them, 1 subtracts the second from the first, 2 keeps only the overlap. Select a face of the first solid, then a face of the second."
    accepts = Accepts(faces=(2, 2))
    params = [Param("mode", "number", 0)]

    def applies(self, topology, selection):
        return len(solids_of(topology.shape)) >= 2

    def run(self, topology, selection, values, preview):
        mode = int(round(values["mode"]))
        if mode not in (0, 1, 2):
            raise OperationError("Mode must be 0 (unite), 1 (subtract) or 2 (intersect)")
        solids = solids_of(topology.shape)
        owners = []
        for face_id in selection.faces:
            face = topology.face(face_id)
            index = next((i for i, solid in enumerate(solids) if _contains(solid, face)), None)
            if index is None:
                raise OperationError("A selected face is not part of a closed solid")
            owners.append(index)
        if owners[0] == owners[1]:
            raise OperationError("Select one face on each of two different solids")
        target, tool = solids[owners[0]], solids[owners[1]]
        if mode == 2:
            from OCP.BRepAlgoAPI import BRepAlgoAPI_Common

            common = BRepAlgoAPI_Common(target, tool)
            common.Build()
            if not common.IsDone() or common.Shape().IsNull() or _volume(common.Shape()) < 1e-9:
                raise OperationError("The two solids do not overlap")
            merged = common.Shape()
        else:
            merged = _combine(target, tool, fuse=mode == 0)
            if _volume(merged) < 1e-9:
                raise OperationError("The result would be empty")
        compound, builder = TopoDS_Compound(), BRep_Builder()
        builder.MakeCompound(compound)
        builder.Add(compound, merged)
        for i, solid in enumerate(solids):
            if i not in owners:
                builder.Add(compound, solid)
        return finish(compound)


@register
class VariableFillet(Tool):
    """Round edges with a radius that changes linearly from `start` at each edge's first vertex to `end` at its last."""

    id = "variable_fillet"
    label = "Variable fillet"
    description = "Rounds edges with a radius that changes along the edge, from the start value at its first end to the end value at its last. Select one or more edges."
    accepts = Accepts(edges=(1, None))
    params = [
        Param("start", "length", 1),
        Param("end", "length", 3),
        Param("reverse", "number", 0),  # 1 swaps which end gets which value
        Param("middle", "length", 0),  # radius at an interim point along the edge; 0 means none
        Param("middle_at", "number", 0.5),  # where along the edge (0 first end, 1 last end), measured after any reverse
    ]

    def run(self, topology, selection, values, preview):
        from OCP.BRepFilletAPI import BRepFilletAPI_MakeFillet
        from OCP.collections import Array1_gp_Pnt2d
        from OCP.gp import gp_Pnt2d

        start, end, middle = values["start"], values["end"], values["middle"]
        if start < MIN_DISTANCE or end < MIN_DISTANCE:
            raise OperationError("Both radii must be positive")
        if middle < 0:
            raise OperationError("The radius at the chosen point cannot be negative")
        if middle >= MIN_DISTANCE and not 0.02 < values["middle_at"] < 0.98:
            raise OperationError("Choose the interim point between 0.02 and 0.98 of the way along the edge")
        if values["reverse"] >= 0.5:
            start, end = end, start
        maker = BRepFilletAPI_MakeFillet(topology.shape)
        edges = [topology.edge(i) for i in selection.edges]
        if middle >= MIN_DISTANCE and len(edges) != 1:
            raise OperationError("A radius at an interim point works on one edge at a time")
        for edge in edges:
            maker.Add(start, end, edge)
        if middle >= MIN_DISTANCE:
            points = Array1_gp_Pnt2d(1, 3)
            for k, (u, r) in enumerate(((0.0, start), (values["middle_at"], middle), (1.0, end)), 1):
                points.SetValue(k, gp_Pnt2d(u, r))
            maker.SetRadius(points, 1, 1)
        try:
            maker.Build()
        except Exception as e:  # OCCT raises Standard_Failure for impossible sizes
            raise OperationError(f"Could not round: {e}") from None
        if not maker.IsDone() or maker.Shape().IsNull() or not BRepCheck_Analyzer(maker.Shape()).IsValid():
            raise OperationError("Could not round these edges with these radii")
        return OpResult(maker.Shape(), [g for edge in edges for g in maker.Generated(edge)])


@register
class FilletPerEdge(Tool):
    """Round the selected edges, each with its own radius. Per edge the form gives a start radius and an end
    radius: an end of 0 (or equal to the start) makes that edge constant, otherwise it is variable. A start of 0
    leaves that edge sharp."""

    id = "fillet_per_edge"
    label = "Fillet per edge"
    description = "Rounds several edges, each with its own radius. Select edges; the form lists one start and end radius per edge, and 0 leaves an edge sharp."
    accepts = Accepts(edges=(1, None))
    params = [Param("radii", "per_edge", 2)]

    def run(self, topology, selection, values, preview):
        from OCP.BRepFilletAPI import BRepFilletAPI_MakeFillet

        radii = values["radii"] or [[self.params[0].default, 0.0] for _ in selection.edges]
        if len(radii) != len(selection.edges):
            raise OperationError(f"Give one radius per edge: {len(selection.edges)} edges selected, {len(radii)} radii")
        maker = BRepFilletAPI_MakeFillet(topology.shape)
        edges = []
        # The kernel can leave stray zero-length edges at corners when edges are added in a different order than
        # the model stores them, so add them in id order whatever the order they were picked in.
        for edge_id, (start, end) in sorted(zip(selection.edges, radii), key=lambda pair: pair[0]):
            if start < 0 or end < 0:
                raise OperationError("Radii cannot be negative")
            if start < MIN_DISTANCE:
                continue  # left sharp
            edge = topology.edge(edge_id)
            edges.append(edge)
            if end < MIN_DISTANCE or abs(end - start) < MIN_DISTANCE:
                maker.Add(start, edge)
            else:
                maker.Add(start, end, edge)
        if not edges:
            raise OperationError("Every radius is 0: nothing to round")
        try:
            maker.Build()
        except Exception as e:
            raise OperationError(f"Could not round: {e}") from None
        if not maker.IsDone() or maker.Shape().IsNull() or not BRepCheck_Analyzer(maker.Shape()).IsValid():
            raise OperationError("Could not round these edges with these radii")
        return OpResult(maker.Shape(), [g for edge in edges for g in maker.Generated(edge)])


def _outer_wire(face):
    from OCP.BRepTools import BRepTools as _BT

    return _BT.OuterWire_s(face)


@register
class LoftFaces(Tool):
    """Join two faces with a solid that blends from the outline of one to the other (`ruled` 1 = straight sides).
    The new solid is fused with the model."""

    id = "loft_faces"
    label = "Loft between faces"
    description = "Joins two faces with a solid that blends from one outline to the other. Select two faces; ruled 1 gives straight sides, 0 a smooth blend."
    accepts = Accepts(faces=(2, 2))
    params = [Param("ruled", "number", 0)]

    def run(self, topology, selection, values, preview):
        from OCP.BRepOffsetAPI import BRepOffsetAPI_ThruSections

        loft = BRepOffsetAPI_ThruSections(True, int(round(values["ruled"])) == 1)
        for face_id in selection.faces:
            loft.AddWire(_outer_wire(topology.face(face_id)))
        try:
            loft.Build()
        except Exception as e:
            raise OperationError(f"Could not loft between these faces: {e}") from None
        if not loft.IsDone() or loft.Shape().IsNull() or _volume(loft.Shape()) < 1e-9:
            raise OperationError("Could not loft between these faces")
        return finish(_combine(topology.shape, loft.Shape(), fuse=True))


@register
class SweepFace(Tool):
    """Sweep the selected face along the selected edge (the path); `mode` 0 adds the swept solid, 1 cuts it."""

    id = "sweep_face"
    label = "Sweep face along edge"
    description = "Pulls a face along an edge to make a solid. Select one face and the edge to follow; mode 0 adds the solid, 1 cuts it."
    accepts = Accepts(faces=(1, 1), edges=(1, 1))
    params = [Param("mode", "number", 0)]

    def run(self, topology, selection, values, preview):
        from OCP.BRepBuilderAPI import BRepBuilderAPI_MakeWire
        from OCP.BRepOffsetAPI import BRepOffsetAPI_MakePipe

        mode = int(round(values["mode"]))
        if mode not in (0, 1):
            raise OperationError("Mode must be 0 (add) or 1 (cut)")
        path = BRepBuilderAPI_MakeWire(topology.edge(selection.edges[0])).Wire()
        pipe = BRepOffsetAPI_MakePipe(path, topology.face(selection.faces[0]))
        try:
            pipe.Build()
        except Exception as e:
            raise OperationError(f"Could not sweep along this edge: {e}") from None
        if not pipe.IsDone() or pipe.Shape().IsNull() or _volume(pipe.Shape()) < 1e-9:
            raise OperationError("Could not sweep this face along this edge")
        return finish(_combine(topology.shape, pipe.Shape(), fuse=mode == 0))


@register
class PathArray(Tool):
    """Copies of the chosen body (the whole model when no face is selected) placed at equal distances along a path of one or more connected edges, starting
    at the model's current position (the first copy is the original); copies are moved, not turned, and fused
    with it. On a closed path the copies are spread round it without doubling up at the start."""

    id = "path_array"
    label = "Array along path"
    description = "Places copies of a body at equal distances along connected edges. Select the edges that form the path, plus any face of the body to copy (none copies the whole model); the count includes the original."
    accepts = Accepts(faces=(0, None), edges=(1, None))
    params = [Param("count", "number", 4)]

    def run(self, topology, selection, values, preview):
        from OCP.BRepAdaptor import BRepAdaptor_CompCurve
        from OCP.BRepBuilderAPI import BRepBuilderAPI_MakeWire
        from OCP.GCPnts import GCPnts_AbscissaPoint

        count = _array_copies(values["count"])
        maker = BRepBuilderAPI_MakeWire()
        for i in selection.edges:
            maker.Add(topology.edge(i))
        if not maker.IsDone():
            raise OperationError("The selected edges do not form one connected path")
        wire = maker.Wire()
        curve = BRepAdaptor_CompCurve(wire)
        total = GCPnts_AbscissaPoint.Length_s(curve)
        closed = curve.IsClosed()
        steps = count if closed else count - 1
        start = curve.Value(curve.FirstParameter())
        transforms = []
        for k in range(1, count):
            locator = GCPnts_AbscissaPoint(curve, total * k / steps, curve.FirstParameter())
            if not locator.IsDone():
                raise OperationError("Could not place the copies along this path")
            trsf = gp_Trsf()
            trsf.SetTranslation(gp_Vec(start, curve.Value(locator.Parameter())))
            transforms.append(trsf)
        return _fuse_copies(topology, selection, transforms)


# Re-radius a fillet ---------------------------------------------------------------------------------------


def _rebuild_round(topology, face, neighbours: list, size: float, chamfer: bool, end_size: float = 0.0) -> OpResult:
    """Remove a fillet or chamfer face (its two neighbours extend back to a sharp edge), then round that edge
    again with `size` (a fillet radius or chamfer leg); size 0 leaves the sharp edge. A fillet with `end_size`
    above 0 is variable: `size` at the edge's first vertex growing or shrinking to `end_size` at its last."""
    from .ops import _follow, fillet_chamfer
    from .topology import Topology

    operation = BRepAlgoAPI_Defeaturing()
    operation.SetShape(topology.shape)
    operation.AddFaceToRemove(face)
    operation.SetRunParallel(True)
    operation.Build()
    if not operation.IsDone() or operation.Shape().IsNull():
        raise OperationError("Could not remove this round to resize it")
    sharp = operation.Shape()
    if size < MIN_DISTANCE:
        return finish(sharp)
    rebuilt = Topology(sharp)
    modified = []
    for n in neighbours:
        found = _follow(operation.History(), [n])
        if len(found) != 1:
            raise OperationError("Could not find the sharp edge left by this round")
        modified.append(found[0])
    shared = [e for _, e in rebuilt.edges() if all(any(f.IsSame(m) for f in rebuilt.edge_faces(e)) for m in modified)]
    if len(shared) != 1:
        raise OperationError("Could not find the sharp edge left by this round")
    if end_size > MIN_DISTANCE and not chamfer:
        from OCP.BRepFilletAPI import BRepFilletAPI_MakeFillet

        maker = BRepFilletAPI_MakeFillet(sharp)
        maker.Add(size, end_size, shared[0])
        try:
            maker.Build()
        except Exception as e:  # OCCT raises Standard_Failure for impossible sizes
            raise OperationError(f"Could not round: {e}") from None
        if not maker.IsDone() or maker.Shape().IsNull() or not BRepCheck_Analyzer(maker.Shape()).IsValid():
            raise OperationError("Could not round this edge with these radii")
        return finish(maker.Shape())
    return finish(fillet_chamfer(sharp, shared, -size if chamfer else size).shape)


def _face_edges(face):
    from OCP.TopAbs import TopAbs_EDGE
    from OCP.TopExp import TopExp_Explorer
    from OCP.TopoDS import TopoDS

    explorer = TopExp_Explorer(face, TopAbs_EDGE)
    while explorer.More():
        yield TopoDS.Edge(explorer.Current())
        explorer.Next()


@register
class ResizeFillet(Tool):
    """Change the radius of a fillet from the fillet face itself: the round is removed (neighbours extended back
    to a sharp edge) and that edge is filleted again. A radius of 0 leaves the sharp edge. Works on constant and
    variable fillets: an end radius of 0 makes the fillet constant, above 0 makes it variable (radius at the
    edge's first vertex growing or shrinking to the end radius at its last)."""

    id = "resize_fillet"
    label = "Resize fillet"
    description = "Changes the radius of an existing fillet. Select the fillet face; an end radius of 0 keeps the radius constant."
    accepts = Accepts(faces=(1, 1))
    params = [Param("radius", "length", 2), Param("end_radius", "length", 0)]

    def applies(self, topology, selection):
        # Constant fillets are cylinders or tori; a variable fillet is a free-form surface.
        return BRepAdaptor_Surface(topology.face(selection.faces[0])).GetType() not in (GeomAbs_Plane,)

    def run(self, topology, selection, values, preview):
        from .measure import _tangent

        face = topology.face(selection.faces[0])
        neighbours = []
        for edge in _face_edges(face):
            for other in topology.edge_faces(edge):
                if not other.IsSame(face) and _tangent(edge, face, other) and not any(other.IsSame(n) for n in neighbours):
                    neighbours.append(other)
        if len(neighbours) != 2:
            raise OperationError("That face is not a simple fillet between two faces")
        return _rebuild_round(topology, face, neighbours, values["radius"], chamfer=False, end_size=values["end_radius"])


@register
class ResizeChamfer(Tool):
    """Change the size of a chamfer from the chamfer face: it is removed and the sharp edge chamfered again with
    equal legs of the given size (0 leaves the sharp edge)."""

    id = "resize_chamfer"
    label = "Resize chamfer"
    description = "Changes the size of an existing chamfer. Select the chamfer face."
    accepts = Accepts(faces=(1, 1))
    params = [Param("size", "length", 2)]

    def applies(self, topology, selection):
        return planar_normal(topology.face(selection.faces[0])) is not None

    def run(self, topology, selection, values, preview):
        face = topology.face(selection.faces[0])
        edges = list(_face_edges(face))
        if len(edges) != 4:
            raise OperationError("That face is not a simple chamfer (it should have four edges)")

        def length(edge) -> float:
            props = GProp_GProps()
            BRepGProp.LinearProperties_s(edge, props)
            return props.Mass()

        long_edges = sorted(edges, key=length, reverse=True)[:2]
        neighbours = []
        for edge in long_edges:
            others = [f for f in topology.edge_faces(edge) if not f.IsSame(face)]
            if len(others) != 1:
                raise OperationError("That face is not a simple chamfer")
            neighbours.append(others[0])
        return _rebuild_round(topology, face, neighbours, values["size"], chamfer=True)


@register
class CutPlane(Tool):
    """Cut the model with a plane square to an axis (0 = X, 1 = Y, 2 = Z) at `position`, removing the side given by
    `remove_side` (+1 removes the part above the plane, -1 the part below)."""

    id = "cut_plane"
    label = "Cut with plane"
    description = "Cuts the model with a plane square to an axis (0 = X, 1 = Y, 2 = Z) at a position and removes one side: +1 removes the part above, -1 the part below. Nothing needs to be selected."
    accepts = Accepts()
    params = [Param("axis", "number", 2), Param("position", "length"), Param("remove_side", "number", 1)]

    def run(self, topology, selection, values, preview):
        axis = int(round(values["axis"]))
        if axis not in (0, 1, 2) or values["remove_side"] not in (1.0, -1.0):
            raise OperationError("axis must be 0, 1 or 2 and remove_side +1 or -1")
        size = 4 * _bounds_diagonal(topology.shape) + 1
        box = Bnd_Box()
        BRepBndLib.Add_s(topology.shape, box)
        centre = [(box.CornerMin().Coord(k + 1) + box.CornerMax().Coord(k + 1)) / 2 for k in range(3)]
        corner = [c - size / 2 for c in centre]
        dims = [size, size, size]
        side = values["remove_side"]
        corner[axis] = values["position"] if side > 0 else values["position"] - size
        slab = BRepPrimAPI_MakeBox(gp_Pnt(*corner), *dims).Shape()
        result = _combine(topology.shape, slab, fuse=False)
        if _volume(result) < 1e-9:
            raise OperationError("The plane would remove the whole model")
        return finish(result)


@register
class SplitPlane(Tool):
    """Split the model into two solids along a plane square to an axis (0 = X, 1 = Y, 2 = Z) at `position`."""

    id = "split_plane"
    label = "Split with plane"
    description = "Splits the model into two solids along a plane square to an axis (0 = X, 1 = Y, 2 = Z) at a position. Nothing needs to be selected."
    accepts = Accepts()
    params = [Param("axis", "number", 2), Param("position", "length")]

    def run(self, topology, selection, values, preview):
        halves = []
        for side in (1, -1):
            cut = get_tool("cut_plane").run(topology, selection, {"axis": values["axis"], "position": values["position"], "remove_side": side}, preview)
            halves.append(cut.shape)
        total = _volume(topology.shape)
        if min(_volume(h) for h in halves) < 1e-9 * max(total, 1) or abs(sum(_volume(h) for h in halves) - total) > 1e-6 * total:
            raise OperationError("The plane does not pass through the model")
        compound, builder = TopoDS_Compound(), BRep_Builder()
        builder.MakeCompound(compound)
        for half in halves:
            for solid in solids_of(half):
                builder.Add(compound, solid)
        return OpResult(compound, [])


@register
class OffsetBody(Tool):
    """Grow (positive) or shrink (negative) the selected solids (all when nothing is selected) by a uniform distance."""

    id = "offset_body"
    label = "Offset body"
    description = "Grows (positive) or shrinks (negative) a solid evenly in all directions. Select any face of the solid, or nothing for the whole model."
    accepts = Accepts(faces=(0, None))
    params = [Param("distance", "length", 1)]

    def run(self, topology, selection, values, preview):
        from OCP.BRepOffsetAPI import BRepOffsetAPI_MakeOffsetShape

        distance = values["distance"]
        if abs(distance) < MIN_DISTANCE:
            return OpResult(topology.shape, [])

        def offset(shape):
            maker = BRepOffsetAPI_MakeOffsetShape()
            try:
                maker.PerformByJoin(shape, distance, TOL)
            except Exception as e:  # OCCT raises Standard_Failure when the offset collapses geometry
                raise OperationError(f"Could not offset by this distance: {e}") from None
            if not maker.IsDone() or maker.Shape().IsNull():
                raise OperationError("Could not offset by this distance")
            return maker.Shape()

        return finish(_on_bodies(topology, selection, offset))


@register
class RoundFace(Tool):
    """Fillet (positive) or chamfer (negative) every edge around the selected faces."""

    id = "round_face"
    label = "Round face edges"
    description = "Rounds (positive) or bevels (negative) every edge around the selected faces in one step. Select one or more faces."
    accepts = Accepts(faces=(1, None))
    params = [Param("distance", "length", 1)]

    def run(self, topology, selection, values, preview):
        from .ops import fillet_chamfer

        edges = []
        for i in selection.faces:
            for edge in _face_edges(topology.face(i)):
                if not any(edge.IsSame(e) for e in edges):
                    edges.append(edge)
        return finish(fillet_chamfer(topology.shape, edges, values["distance"]).shape)


def combine(shape: TopoDS_Shape, other: TopoDS_Shape, mode: str, offset: gp_Vec | None = None) -> OpResult:
    """Boolean of the model with another solid (mode "union", "cut" or "intersect"), the other optionally moved first."""
    from OCP.BRepAlgoAPI import BRepAlgoAPI_Common

    if mode not in ("union", "cut", "intersect"):
        raise OperationError("mode must be union, cut or intersect")
    if offset is not None and offset.Magnitude() > 0:
        other = _moved(other, offset)
    if mode == "intersect":
        common = BRepAlgoAPI_Common(shape, other)
        common.SetRunParallel(True)
        common.Build()
        if not common.IsDone() or common.Shape().IsNull():
            raise OperationError("The shapes do not intersect")
        result = common.Shape()
    else:
        result = _combine(shape, other, fuse=mode == "union")
    if _volume(result) < 1e-9:
        raise OperationError("The result would be empty")
    return finish(result)


@register
class InsetFace(_PlanarFace):
    """Offset the outline of a flat face inward and split the face along it, so the inner region can be
    pushed, pulled or cut on its own. A negative distance is not accepted: the loop stays on the face."""

    id = "inset_face"
    label = "Inset face outline"
    description = "Draws an inner outline on a flat face, a set distance in from its edge, so that inner area can be pushed, pulled or cut on its own. Select one flat face."
    accepts = Accepts(faces=(1, 1))
    params = [Param("distance", "length", 2), Param("loop", "number", 0)]

    def run(self, topology, selection, values, preview):
        from build123d import Face, Kind
        from OCP.BRepAlgoAPI import BRepAlgoAPI_Splitter

        distance = values["distance"]
        if distance < MIN_DISTANCE:
            raise OperationError("The inset distance must be positive")
        face = Face(topology.face(selection.faces[0]))
        loop = int(round(values.get("loop", 0)))
        holes = face.inner_wires()
        if not 0 <= loop <= len(holes):
            raise OperationError(f"The face has {len(holes)} inner loop(s); loop must be 0 (outline) to {len(holes)}")
        try:
            if loop == 0:
                inner = face.outer_wire().offset_2d(-distance, kind=Kind.INTERSECTION)
            else:  # grow a hole's loop outward, so the ring around the hole becomes its own region
                inner = holes[loop - 1].offset_2d(distance, kind=Kind.INTERSECTION)
            inner = inner[0] if isinstance(inner, list) else inner
            region = Face(inner)
        except Exception:
            raise OperationError("The inset is larger than the face") from None
        if (loop == 0 and region.area >= face.area) or region.area < MIN_DISTANCE:
            raise OperationError("The inset is larger than the face")
        splitter = BRepAlgoAPI_Splitter()
        arguments, tools = List_TopoDS_Shape(), List_TopoDS_Shape()
        arguments.Append(topology.shape)
        tools.Append(region.wrapped)
        splitter.SetArguments(arguments)
        splitter.SetTools(tools)
        splitter.SetNonDestructive(True)
        splitter.Build()
        if not splitter.IsDone() or splitter.Shape().IsNull():
            raise OperationError("Could not split the face along the inset")
        return OpResult(splitter.Shape(), [], unified=True)  # the split is the point: skip the same-surface merge


@register
class DivideFace(_PlanarFace):
    """Add a dividing edge straight across a flat face, parallel to its first (`across` = 0) or second
    (`across` = 1) in-plane axis, `offset` from the face centre, so each side can be moved on its own."""

    id = "divide_face"
    label = "Divide face"
    description = "Adds a dividing line straight across a flat face so each side can be moved on its own. Select one flat face; across picks the direction (0 or 1) and offset the position from the centre."
    accepts = Accepts(faces=(1, 1))
    params = [Param("across", "number", 0), Param("offset", "length")]

    def run(self, topology, selection, values, preview):
        from OCP.BRepAlgoAPI import BRepAlgoAPI_Splitter
        from OCP.BRepBuilderAPI import BRepBuilderAPI_MakeEdge

        face = topology.face(selection.faces[0])
        centre, _, u, v = _plane_axes(face)
        along, step = (u, v) if int(values["across"]) == 0 else (v, u)
        reach = _bounds_diagonal(face) * 2
        middle = centre.Translated(gp_Vec(step).Multiplied(values["offset"]))
        start = middle.Translated(gp_Vec(along).Multiplied(-reach))
        end = middle.Translated(gp_Vec(along).Multiplied(reach))
        line = BRepBuilderAPI_MakeEdge(start, end).Edge()
        splitter = BRepAlgoAPI_Splitter()
        arguments, tools = List_TopoDS_Shape(), List_TopoDS_Shape()
        arguments.Append(face)
        tools.Append(line)
        splitter.SetArguments(arguments)
        splitter.SetTools(tools)
        splitter.Build()
        if not splitter.IsDone() or splitter.Shape().IsNull():
            raise OperationError("Could not divide the face")
        pieces = []
        explorer = _Explorer(splitter.Shape(), TopAbs_FACE)
        while explorer.More():
            pieces.append(explorer.Current())
            explorer.Next()
        if len(pieces) < 2:
            raise OperationError("The dividing edge does not cross the face")
        # Replace the face in the model by its pieces through a second split of the whole shape with the face edges.
        whole = BRepAlgoAPI_Splitter()
        arguments, tools = List_TopoDS_Shape(), List_TopoDS_Shape()
        arguments.Append(topology.shape)
        for piece in pieces:
            tools.Append(piece)
        whole.SetArguments(arguments)
        whole.SetTools(tools)
        whole.SetNonDestructive(True)
        whole.Build()
        if not whole.IsDone() or whole.Shape().IsNull():
            raise OperationError("Could not divide the face")
        return OpResult(whole.Shape(), [], unified=True)  # the split is the point: skip the same-surface merge

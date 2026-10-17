"""Feature tools beyond push/pull and fillet: delete face (heal), hole edits, primitives, shell, mirror, draft.

Every tool is registered with `@register` and shows up in the UI's tool list without frontend changes.
Holes are edited by fusing the old cylinder back in (which fills the hole exactly) and cutting a new one,
so no history or topological naming is needed: the tool reads what the face is now.
"""

import math

from OCP.BRepAdaptor import BRepAdaptor_Surface
from OCP.BRepAlgoAPI import BRepAlgoAPI_Defeaturing
from OCP.BRepBuilderAPI import BRepBuilderAPI_Copy, BRepBuilderAPI_Transform
from OCP.BRepCheck import BRepCheck_Analyzer
from OCP.BRepGProp import BRepGProp
from OCP.BRepOffsetAPI import BRepOffsetAPI_DraftAngle, BRepOffsetAPI_MakeThickSolid
from OCP.BRepPrimAPI import BRepPrimAPI_MakeBox, BRepPrimAPI_MakeCone, BRepPrimAPI_MakeCylinder, BRepPrimAPI_MakeSphere
from OCP.BRepBndLib import BRepBndLib
from OCP.Bnd import Bnd_Box
from OCP.BRepTools import BRepTools
from OCP.GProp import GProp_GProps
from OCP.GeomAbs import GeomAbs_Cylinder, GeomAbs_Plane, GeomAbs_Torus
from OCP.ShapeUpgrade import ShapeUpgrade_UnifySameDomain
from OCP.TopoDS import TopoDS_Shape
from OCP.collections import List_TopoDS_Shape
from OCP.gp import gp_Ax1, gp_Ax2, gp_Dir, gp_Pln, gp_Pnt, gp_Trsf, gp_Vec

from .ops import MIN_DISTANCE, OperationError, OpResult, _boolean, planar_normal, push_pull
from .tools import Accepts, Param, Tool, register

TOL = 1e-6


def finish(shape: TopoDS_Shape) -> OpResult:
    """Merge faces that share a surface, check the result, and return it (the selection is not carried over)."""
    copy = BRepBuilderAPI_Copy(shape, False, True)  # UnifySameDomain edits its input in place
    unify = ShapeUpgrade_UnifySameDomain(copy.Shape(), True, True, True)
    unify.Build()
    result = unify.Shape()
    if result.IsNull() or not BRepCheck_Analyzer(result).IsValid():
        raise OperationError("Operation produced invalid geometry")
    return OpResult(result, [])


def _combine(shape: TopoDS_Shape, tool: TopoDS_Shape, fuse: bool) -> TopoDS_Shape:
    operation = _boolean(shape, tool, fuse, glue=False)
    if operation is None:
        raise OperationError("Boolean operation failed")
    return operation.Shape()


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

    def solid(self, radius: float | None = None, offset: gp_Vec | None = None) -> TopoDS_Shape:
        origin = self.origin.Translated(offset) if offset is not None else self.origin
        return _cylinder(origin, self.direction, self.radius if radius is None else radius, self.length)


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
    accepts = Accepts(faces=(1, None))

    def run(self, topology, selection, values, preview):
        return _defeature(topology, selection, "delete these faces")


@register
class RemoveRound(Tool):
    """Remove fillets or chamfers by deleting their faces; the adjacent faces extend back to a sharp edge."""

    id = "remove_round"
    label = "Remove fillet/chamfer"
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
    label = "Fill hole"
    accepts = Accepts(faces=(1, None))

    def run(self, topology, selection, values, preview):
        shape = topology.shape
        for hole in _holes(topology, selection):
            shape = _combine(shape, hole.solid(), fuse=True)
        return finish(shape)


@register
class ResizeHole(_CylinderFaces):
    """Change a hole's diameter, keeping its axis and depth. A diameter of 0 leaves it unchanged."""

    id = "resize_hole"
    label = "Resize hole"
    accepts = Accepts(faces=(1, None))
    params = [Param("diameter", "length", 0.0)]

    def run(self, topology, selection, values, preview):
        diameter = values["diameter"]
        if diameter < 0:
            raise OperationError("The diameter can't be negative")
        shape = topology.shape
        if diameter < MIN_DISTANCE:
            return OpResult(shape, [topology.face(i) for i in selection.faces])
        for hole in _holes(topology, selection):
            shape = _combine(shape, hole.solid(), fuse=True)
            shape = _combine(shape, hole.solid(radius=diameter / 2), fuse=False)
        return finish(shape)


@register
class MoveHole(_CylinderFaces):
    id = "move_hole"
    label = "Move hole"
    accepts = Accepts(faces=(1, None))
    params = [Param("dx", "length"), Param("dy", "length"), Param("dz", "length")]

    def run(self, topology, selection, values, preview):
        offset = gp_Vec(values["dx"], values["dy"], values["dz"])
        shape = topology.shape
        if offset.Magnitude() < MIN_DISTANCE:
            return OpResult(shape, [topology.face(i) for i in selection.faces])
        for hole in _holes(topology, selection):
            shape = _combine(shape, hole.solid(), fuse=True)
            shape = _combine(shape, hole.solid(offset=offset), fuse=False)
        return finish(shape)


@register
class PatternHole(_CylinderFaces):
    """Copies of a hole at a fixed spacing (a linear pattern): `count` holes in total."""

    id = "pattern_hole"
    label = "Pattern hole"
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
            shape = _combine(shape, hole.solid(offset=step.Multiplied(i)), fuse=False)
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


@register
class AddCounterbore(_HoleOnFace):
    """A hole with a wider, flat-bottomed recess at the top (for socket-head screws)."""

    id = "add_counterbore"
    label = "Add counterbore"
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
        shape = topology.shape
        for hole, delta in zip(holes, deltas):
            if abs(delta) < MIN_DISTANCE:
                continue
            offset = gp_Vec(*(delta if k == axis else 0.0 for k in range(3)))
            shape = _combine(shape, hole.solid(), fuse=True)
            shape = _combine(shape, hole.solid(offset=offset), fuse=False)
        return finish(shape)


@register
class AlignHoles(_HoleGroup):
    """Match the position of every selected hole to the first selected one along an axis (Figma-style align)."""

    id = "align_holes"
    label = "Align holes"
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
    label = "Distribute holes"
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


# Solids ----------------------------------------------------------------------------------------------


@register
class AddBox(Tool):
    """A box joined to the model, given by its minimum corner and size."""

    id = "add_box"
    label = "Add box"
    accepts = Accepts()
    params = [
        Param("width", "length", 10),
        Param("depth", "length", 10),
        Param("height", "length", 10),
        Param("x", "length"),
        Param("y", "length"),
        Param("z", "length"),
    ]

    def run(self, topology, selection, values, preview):
        if min(values["width"], values["depth"], values["height"]) < MIN_DISTANCE:
            raise OperationError("The box sizes must be positive")
        box = BRepPrimAPI_MakeBox(gp_Pnt(values["x"], values["y"], values["z"]), values["width"], values["depth"], values["height"]).Shape()
        return finish(_combine(topology.shape, box, fuse=True))


@register
class AddCylinder(Tool):
    """A cylinder standing on the XY plane at (x, y, z), joined to the model."""

    id = "add_cylinder"
    label = "Add cylinder"
    accepts = Accepts()
    params = [Param("diameter", "length", 10), Param("height", "length", 10), Param("x", "length"), Param("y", "length"), Param("z", "length")]

    def run(self, topology, selection, values, preview):
        if min(values["diameter"], values["height"]) < MIN_DISTANCE:
            raise OperationError("The cylinder sizes must be positive")
        cylinder = _cylinder(gp_Pnt(values["x"], values["y"], values["z"]), gp_Dir(0, 0, 1), values["diameter"] / 2, values["height"])
        return finish(_combine(topology.shape, cylinder, fuse=True))


@register
class Shell(Tool):
    """Hollow the solid, leaving the selected faces open; the wall thickness grows inward."""

    id = "shell"
    label = "Shell"
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
    accepts = Accepts(faces=(1, 1))
    params = [Param("offset", "length")]

    def run(self, topology, selection, values, preview):
        centre, normal, _, _ = _plane_axes(topology.face(selection.faces[0]))
        centre = centre.Translated(gp_Vec(normal).Multiplied(values["offset"]))
        transform = gp_Trsf()
        transform.SetMirror(gp_Ax2(centre, normal))
        mirrored = BRepBuilderAPI_Transform(topology.shape, transform, True).Shape()
        return finish(_combine(topology.shape, mirrored, fuse=True))


@register
class Draft(_PlanarFace):
    """Tilt flat faces by an angle about the lowest point of the model along the pull direction (default Z)."""

    id = "draft"
    label = "Draft"
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


@register
class MoveBody(Tool):
    """Move the whole model by a vector."""

    id = "move_body"
    label = "Move body"
    accepts = Accepts()
    params = [Param("dx", "length"), Param("dy", "length"), Param("dz", "length")]

    def run(self, topology, selection, values, preview):
        offset = gp_Vec(values["dx"], values["dy"], values["dz"])
        if offset.Magnitude() < MIN_DISTANCE:
            return OpResult(topology.shape, [])
        return finish(_moved(topology.shape, offset))


@register
class RotateBody(Tool):
    """Rotate the whole model about an axis through the origin (axis: 0 = X, 1 = Y, 2 = Z)."""

    id = "rotate_body"
    label = "Rotate body"
    accepts = Accepts()
    params = [Param("axis", "number", 2), Param("angle", "angle", 90)]

    def run(self, topology, selection, values, preview):
        axis = int(round(values["axis"]))
        if axis not in (0, 1, 2):
            raise OperationError("The axis must be 0 (X), 1 (Y) or 2 (Z)")
        direction = gp_Dir(*(1.0 if k == axis else 0.0 for k in range(3)))
        transform = gp_Trsf()
        transform.SetRotation(gp_Ax1(gp_Pnt(0, 0, 0), direction), math.radians(values["angle"]))
        return finish(BRepBuilderAPI_Transform(topology.shape, transform, True).Shape())


@register
class ScaleBody(Tool):
    """Scale the whole model uniformly about the origin."""

    id = "scale_body"
    label = "Scale body"
    accepts = Accepts()
    params = [Param("factor", "number", 1)]

    def run(self, topology, selection, values, preview):
        factor = values["factor"]
        if factor < 1e-3 or factor > 1e3:
            raise OperationError("The scale factor must be between 0.001 and 1000")
        transform = gp_Trsf()
        transform.SetScale(gp_Pnt(0, 0, 0), factor)
        return finish(BRepBuilderAPI_Transform(topology.shape, transform, True).Shape())


@register
class AddSphere(Tool):
    id = "add_sphere"
    label = "Add sphere"
    accepts = Accepts()
    params = [Param("diameter", "length", 10), Param("x", "length"), Param("y", "length"), Param("z", "length")]

    def run(self, topology, selection, values, preview):
        if values["diameter"] < MIN_DISTANCE:
            raise OperationError("The diameter must be positive")
        sphere = BRepPrimAPI_MakeSphere(gp_Pnt(values["x"], values["y"], values["z"]), values["diameter"] / 2).Shape()
        return finish(_combine(topology.shape, sphere, fuse=True))


@register
class AddCone(Tool):
    """A cone (or truncated cone) standing on the XY plane at (x, y, z)."""

    id = "add_cone"
    label = "Add cone"
    accepts = Accepts()
    params = [
        Param("bottom_diameter", "length", 10),
        Param("top_diameter", "length"),
        Param("height", "length", 10),
        Param("x", "length"),
        Param("y", "length"),
        Param("z", "length"),
    ]

    def run(self, topology, selection, values, preview):
        if values["bottom_diameter"] < 0 or values["top_diameter"] < 0 or values["bottom_diameter"] + values["top_diameter"] < MIN_DISTANCE or values["height"] < MIN_DISTANCE:
            raise OperationError("Give a positive height and at least one positive diameter")
        axes = gp_Ax2(gp_Pnt(values["x"], values["y"], values["z"]), gp_Dir(0, 0, 1))
        cone = BRepPrimAPI_MakeCone(axes, values["bottom_diameter"] / 2, values["top_diameter"] / 2, values["height"]).Shape()
        return finish(_combine(topology.shape, cone, fuse=True))


# Re-radius a fillet ---------------------------------------------------------------------------------------


@register
class ResizeFillet(Tool):
    """Change the radius of a fillet from the fillet face itself: the round is removed (neighbours extended back
    to a sharp edge) and that edge is filleted again. A radius of 0 leaves the sharp edge."""

    id = "resize_fillet"
    label = "Resize fillet"
    accepts = Accepts(faces=(1, 1))
    params = [Param("radius", "length", 2)]

    def applies(self, topology, selection):
        return BRepAdaptor_Surface(topology.face(selection.faces[0])).GetType() in (GeomAbs_Cylinder, GeomAbs_Torus)

    def run(self, topology, selection, values, preview):
        from OCP.TopAbs import TopAbs_EDGE
        from OCP.TopExp import TopExp_Explorer
        from OCP.TopoDS import TopoDS

        from .measure import _tangent
        from .ops import _follow, fillet_chamfer
        from .topology import Topology

        face = topology.face(selection.faces[0])
        neighbours = []
        explorer = TopExp_Explorer(face, TopAbs_EDGE)
        while explorer.More():
            edge = TopoDS.Edge(explorer.Current())
            for other in topology.edge_faces(edge):
                if not other.IsSame(face) and _tangent(edge, face, other) and not any(other.IsSame(n) for n in neighbours):
                    neighbours.append(other)
            explorer.Next()
        if len(neighbours) != 2:
            raise OperationError("That face is not a simple fillet between two faces")
        operation = BRepAlgoAPI_Defeaturing()
        operation.SetShape(topology.shape)
        operation.AddFaceToRemove(face)
        operation.SetRunParallel(True)
        operation.Build()
        if not operation.IsDone() or operation.Shape().IsNull():
            raise OperationError("Could not remove this fillet to resize it")
        sharp = operation.Shape()
        radius = values["radius"]
        if radius < MIN_DISTANCE:
            return finish(sharp)
        rebuilt = Topology(sharp)
        modified = []
        for n in neighbours:
            found = _follow(operation.History(), [n])
            if len(found) != 1:
                raise OperationError("Could not find the sharp edge left by this fillet")
            modified.append(found[0])
        shared = [e for _, e in rebuilt.edges() if all(any(f.IsSame(m) for f in rebuilt.edge_faces(e)) for m in modified)]
        if len(shared) != 1:
            raise OperationError("Could not find the sharp edge left by this fillet")
        return finish(fillet_chamfer(sharp, shared, radius).shape)

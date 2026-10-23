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

from .ops import edge_curve, edge_outward_normal, face_handle_point, MIN_DISTANCE, OperationError, OpResult, _boolean, _contains, planar_normal, push_pull, solids_of
from .tools import Accepts, Handle, Param, Tool, get_tool, register, round_handles
from .shared.arrays import _array_copies, _fuse_copies
from .shared.bodies import _body_bounds, _body_centre, _chosen_solids, _on_bodies, _pivot_point
from .shared.faces import _chamfer_with_face, _face_edges, _PlanarFace, _plane_axes, _rebuild_round
from .shared.hole_groups import _CylinderFaces, _HoleGroup, _HoleOnFace, _holes, apply_holes, Hole
from .shared.planes import _cut_target, _model_middle, _plane_frame, _plane_handles, _plane_normal, _tilted, TILT
from .shared.primitives import _position_handles, _turned, _with_rotation, ROTATION
from .shared.solids import (
    _add_material,
    _bounds_diagonal,
    _combine,
    _compound,
    _cylinder,
    _defeature,
    _faces_of,
    _new_body,
    _sew_into,
    _volume,
    finish,
    NEW_BODY,
    TOL,
)

# Solids ----------------------------------------------------------------------------------------------


# Whole-body transforms and more primitives -----------------------------------------------------------------


@register
class LinearArray(Tool):
    """Copies of the chosen body (the whole model when no face is selected) at equal steps (dx, dy, dz), fused with it. `count` includes the original."""

    id = "linear_array"
    whole_model_needs_one_body = True
    label = "Linear array"
    description = "Makes copies of a body in a straight line and fuses them. Select any face of the body, or nothing for the whole model; the count includes the original."
    accepts = Accepts(faces=(0, None))
    params = [Param("count", "number", 3), Param("dx", "length", 20), Param("dy", "length"), Param("dz", "length")]
    move_vector = ("dx", "dy", "dz")

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
    whole_model_needs_one_body = True
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


@register
class ChamferTwoDistances(Tool):
    """Chamfer edges with different leg lengths: `first` along the selected reference face, `second` on the other."""

    id = "chamfer_two_distances"
    label = "Chamfer (two distances)"
    description = "Bevels edges with a different distance on each side. Select one face (it sets which side is first) and one or more of its edges."
    accepts = Accepts(faces=(1, 1), edges=(1, None))
    params = [Param("first", "length", 2), Param("second", "length", 1), Param("swap", "number", 0)]  # swap 1 puts `first` on the other side

    def handles(self, topology, selection, values):
        edge = topology.edge(selection.edges[0])
        reference = topology.face(selection.faces[0])
        others = [f for f in topology.edge_faces(edge) if not f.IsSame(reference)]
        normal = edge_outward_normal(topology, edge)
        if not others or normal is None:
            return []
        at, tangent, length = edge_curve(edge)
        mid, along = at(0.5), gp_Vec(*tangent(0.5))

        def into(face):  # unit direction in the face, square to the edge, pointing into the face
            v = gp_Vec(gp_Pnt(*mid), face_handle_point(face))
            v.Subtract(along.Multiplied(v.Dot(along)))
            if v.Magnitude() < 1e-9:
                return None
            v.Normalize()
            return (v.X(), v.Y(), v.Z())

        on_reference, on_other = into(reference), into(others[0])
        if on_reference is None or on_other is None:
            return []
        swapped = values["swap"] >= 0.5
        first_dir, second_dir = (on_other, on_reference) if swapped else (on_reference, on_other)
        point = lambda d, size: tuple(m + x * size for m, x in zip(mid, d))  # noqa: E731
        lift = max(length * 0.1, 1.0)
        return [
            Handle("first", "First distance", point(first_dir, values["first"]), first_dir, min=MIN_DISTANCE),
            Handle("second", "Second distance", point(second_dir, values["second"]), second_dir, min=MIN_DISTANCE),
            Handle("swap", "Swap the two sides (click)", point(normal, lift), tuple(normal), toggle=True),
        ]

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

    def combines(self, topology, selection, values):
        solids = solids_of(topology.shape)
        return [i for i, solid in enumerate(solids) if any(_contains(solid, topology.face(f)) for f in selection.faces)]

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

    def handles(self, topology, selection, values):
        edge = topology.edge(selection.edges[0])
        normal = edge_outward_normal(topology, edge)
        if normal is None:
            return []
        at, tangent, length = edge_curve(edge)
        up = lambda point, size: tuple(p + n * size for p, n in zip(point, normal))  # noqa: E731  (a point lifted along the bisector)
        reverse = values["reverse"] >= 0.5
        lift = max(length * 0.08, 1.0)  # the interim and swap markers float this far above the edge so they never sit on the end handles
        found = [
            # The start value belongs to the edge's first end unless the ends are swapped.
            Handle("start", "Start radius", up(at(1.0 if reverse else 0.0), values["start"]), tuple(normal), min=MIN_DISTANCE),
            Handle("end", "End radius", up(at(0.0 if reverse else 1.0), values["end"]), tuple(normal), min=MIN_DISTANCE),
            Handle("reverse", "Swap the two ends (click)", up(at(0.12), lift), tuple(normal), toggle=True),
        ]
        if len(selection.edges) == 1:
            u = min(max(values["middle_at"], 0.02), 0.98)
            found.append(Handle("middle", "Radius at the interim point (0 = none)", up(at(u), values["middle"] + lift), tuple(normal), min=0.0))
            found.append(Handle("middle_at", "Interim point along the edge", at(u), tangent(u), scale=1 / max(length, MIN_DISTANCE), min=0.02, max=0.98, unit=""))
        return found

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


def _half_space(shape, normal, position: float, above: bool):
    """A block covering everything past the plane `normal . x = position` (on the normal's side when `above`)."""
    from OCP.gp import gp_Ax2, gp_Dir

    size = 4 * _bounds_diagonal(shape) + 1
    box = Bnd_Box()
    BRepBndLib.Add_s(shape, box)
    centre = gp_Pnt(*[(box.CornerMin().Coord(k + 1) + box.CornerMax().Coord(k + 1)) / 2 for k in range(3)])
    ax = gp_Ax2(centre, gp_Dir(*normal))
    along = sum(normal[k] * centre.Coord(k + 1) for k in range(3))  # how far the model's middle sits along the normal
    start = (position - along) if above else (position - along - size)  # the block's low face, measured from the middle
    corner = gp_Pnt(centre.X() + normal[0] * start - (ax.XDirection().X() + ax.YDirection().X()) * size / 2,
                    centre.Y() + normal[1] * start - (ax.XDirection().Y() + ax.YDirection().Y()) * size / 2,
                    centre.Z() + normal[2] * start - (ax.XDirection().Z() + ax.YDirection().Z()) * size / 2)
    return BRepPrimAPI_MakeBox(gp_Ax2(corner, gp_Dir(*normal), ax.XDirection()), size, size, size).Shape()


def _cutting_plane(shape, values) -> tuple[tuple[float, float, float], float]:
    """The plane's unit normal and its distance from the origin along it. `position` is measured along the untilted
    normal; tilt_u and tilt_v turn the plane about two axes through the point of it nearest the model's middle."""
    base = _plane_normal(values)
    tu, tv = values.get("tilt_u", 0.0), values.get("tilt_v", 0.0)
    if abs(tu) < 1e-9 and abs(tv) < 1e-9:
        return base, values["position"]
    u, v = _plane_frame(base)
    normal = _tilted(_tilted(base, u, tu), v, tv)
    mid = _model_middle(shape)
    pivot = [mid[k] + base[k] * (values["position"] - sum(base[i] * mid[i] for i in range(3))) for k in range(3)]
    return normal, sum(normal[k] * pivot[k] for k in range(3))


def _cut_bodies(topology, selection, values) -> TopoDS_Shape:
    """Cut the chosen bodies (every body when none is chosen) with the plane. `remove_side` +1 drops the part on the normal's side,
    -1 the other part, 0 keeps both parts as separate bodies. Bodies the plane misses stay as they are."""
    side = values["remove_side"]
    if side not in (1.0, -1.0, 0.0):
        raise OperationError("remove_side must be +1, -1 or 0 (keep both)")
    chosen, target = _cut_target(topology, selection)
    normal, position = _cutting_plane(target, values)
    out, cut = [], False
    for solid in solids_of(topology.shape):
        if chosen and not any(solid.IsSame(c) for c in chosen):
            out.append(solid)
            continue
        piece = _compound([solid])
        below = _combine(piece, _half_space(target, normal, position, above=True), fuse=False)  # removing the block above leaves the lower part
        above = _combine(piece, _half_space(target, normal, position, above=False), fuse=False)
        vb, va, total = _volume(below), _volume(above), _volume(solid)
        tiny = 1e-9 * max(total, 1)
        if abs(vb + va - total) > 1e-6 * total:  # a cut that leaves nothing reports the whole body: the plane misses it
            middle = _model_middle(solid)
            lower = sum(normal[k] * middle[k] for k in range(3)) < position
            vb, va = (total, 0.0) if lower else (0.0, total)
        if min(vb, va) < tiny:  # the plane misses this body: it is all on one side
            kept = vb if side > 0 else va
            if side != 0 and kept < tiny:
                cut = True  # the whole body is on the removed side
            else:
                out.append(solid)
            continue
        cut = True
        for half in ((below, above) if side == 0 else ((below,) if side > 0 else (above,))):
            out.extend(solids_of(half))
    if side == 0 and not cut:
        raise OperationError("The plane does not pass through the model")
    if not out:
        raise OperationError("The plane would remove the whole model")
    return _compound(out)


@register
class CutPlane(Tool):
    """Cut the model with a plane (square to world axis 0 = X, 1 = Y, 2 = Z, or to the direction nx, ny, nz with
    axis 3) at `position` along its normal. `remove_side` +1 removes the part on the normal's side, -1 the other
    part, 0 keeps both as separate bodies (a split)."""

    id = "cut_plane"
    label = "Cut with plane"
    description = "Cuts the model with a plane and keeps one side or both. Drag the arrow to slide the plane and the two rings to tilt it (tilt_u, tilt_v). Axis 0, 1, 2 is X, Y, Z; axis 3 uses the direction nx, ny, nz. Position is the plane's distance from the origin along its direction. Remove side +1 removes the part on the direction's side, -1 the other part, 0 keeps both as two separate bodies. Select bodies to cut only those; with nothing selected every body is cut."
    accepts = Accepts(faces=(0, None), bodies=(0, None))
    params = [Param("axis", "number", 2), Param("position", "length"), Param("remove_side", "number", 1), Param("nx", "number", 0), Param("ny", "number", 0), Param("nz", "number", 1), *TILT]

    def handles(self, topology, selection, values):
        return _plane_handles(topology, selection, values)

    def run(self, topology, selection, values, preview):
        return OpResult(_cut_bodies(topology, selection, values), [])


@register
class SplitPlane(Tool):
    """Split the model into two solids along a plane; the same as Cut with plane keeping both sides."""

    id = "split_plane"
    label = "Split with plane"
    description = "Splits the model into two solids along a plane (axis 0, 1, 2 = X, Y, Z or 3 for the direction nx, ny, nz). Cut with plane does the same with its keep-both choice. Select bodies to cut only those; with nothing selected every body is cut."
    accepts = Accepts(faces=(0, None), bodies=(0, None))
    params = [Param("axis", "number", 2), Param("position", "length"), Param("nx", "number", 0), Param("ny", "number", 0), Param("nz", "number", 1), *TILT]
    hidden = True

    def handles(self, topology, selection, values):
        return _plane_handles(topology, selection, values)

    def run(self, topology, selection, values, preview):
        return get_tool("cut_plane").run(topology, selection, {**values, "remove_side": 0.0}, preview)


@register
class OffsetBody(Tool):
    """Grow (positive) or shrink (negative) the selected solids (all when nothing is selected) by a uniform distance."""

    id = "offset_body"
    whole_model_needs_one_body = True
    keeps_body_order = True
    label = "Offset body"
    description = "Grows (positive) or shrinks (negative) a solid evenly in all directions. Select bodies, any face of the solid, or nothing for the whole model."
    accepts = Accepts(faces=(0, None), bodies=(0, None))
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


@register
class InsetFace(_PlanarFace):
    """Offset the edges of a flat face and split the face along them, so the inner region can be pushed, pulled or cut
    on its own. The outer outline moves inward and an inner profile (a hole) grows outward, so the loop stays on the face.
    By default one loop is inset; with `all_loops` set every edge of the face is."""

    id = "inset_face"
    label = "Inset face edges"
    description = "Draws an inner outline on a flat face, a set distance in from its edges, so that inner area can be pushed, pulled or cut on its own. Select one flat face. Set all_loops to 1 to inset the outer perimeter and every inner profile together; otherwise loop picks one (0 is the outer perimeter)."
    accepts = Accepts(faces=(1, 1))
    params = [Param("distance", "length", 2), Param("loop", "number", 0), Param("all_loops", "number", 0)]

    def handles(self, topology, selection, values):
        from build123d import Face

        shape = topology.face(selection.faces[0])
        normal = planar_normal(shape)
        if normal is None:
            return []
        face = Face(shape)
        n = (normal.X(), normal.Y(), normal.Z())
        holes = face.inner_wires()
        loop = int(round(values.get("loop", 0)))
        outer = loop == 0 or values.get("all_loops", 0) >= 0.5
        if not outer and not 0 < loop <= len(holes):
            return []
        wire = face.outer_wire() if outer else holes[loop - 1]
        p, t = wire.position_at(0.0), wire.tangent_at(0.0)
        side = (n[1] * t.Z - n[2] * t.Y, n[2] * t.X - n[0] * t.Z, n[0] * t.Y - n[1] * t.X)
        length = math.sqrt(sum(c * c for c in side)) or 1.0
        side = tuple(c / length for c in side)
        aim = face.center() if outer else Face(wire).center()  # inward for the outline, away from the hole for a hole
        toward = (aim.X - p.X) * side[0] + (aim.Y - p.Y) * side[1] + (aim.Z - p.Z) * side[2]
        if (toward < 0) == outer:
            side = tuple(-c for c in side)
        d = values["distance"]
        centre = face_handle_point(shape)
        return [
            Handle("distance", "Inset distance", (p.X + side[0] * d, p.Y + side[1] * d, p.Z + side[2] * d), side, min=MIN_DISTANCE),
            Handle("all_loops", "Inset every edge, outer and inner (click)", (centre.X(), centre.Y(), centre.Z()), n, toggle=True),
        ]

    def run(self, topology, selection, values, preview):
        from build123d import Face, Kind
        from OCP.BRepAlgoAPI import BRepAlgoAPI_Splitter

        distance = values["distance"]
        if distance < MIN_DISTANCE:
            raise OperationError("The inset distance must be positive")
        face = Face(topology.face(selection.faces[0]))
        loop = int(round(values.get("loop", 0)))
        every = values.get("all_loops", 0) >= 0.5
        holes = face.inner_wires()
        if not every and not 0 <= loop <= len(holes):
            raise OperationError(f"The face has {len(holes)} inner loop(s); loop must be 0 (outline) to {len(holes)}")

        def region_of(wire, grow: bool) -> Face:
            inner = wire.offset_2d(distance if grow else -distance, kind=Kind.INTERSECTION)
            return Face(inner[0] if isinstance(inner, list) else inner)

        regions = []
        try:
            if every or loop == 0:
                outline = region_of(face.outer_wire(), False)
                if outline.area >= face.area:
                    raise OperationError("The inset is larger than the face")
                regions.append(outline)
            if every:
                regions += [region_of(h, True) for h in holes]  # a hole's loop grows outward, so the ring around it becomes its own region
            elif loop > 0:
                regions.append(region_of(holes[loop - 1], True))
        except OperationError:
            raise
        except Exception:
            raise OperationError("The inset is larger than the face") from None
        if any(r.area < MIN_DISTANCE for r in regions):
            raise OperationError("The inset is larger than the face")
        splitter = BRepAlgoAPI_Splitter()
        arguments, tools = List_TopoDS_Shape(), List_TopoDS_Shape()
        arguments.Append(topology.shape)
        for r in regions:
            tools.Append(r.wrapped)
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


from . import hole_tools  # noqa: E402,F401  (registers the hole tools; it needs `finish` defined above)

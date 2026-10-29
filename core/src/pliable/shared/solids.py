"""Building blocks for finishing and combining solids, used by several tools."""

import math

from OCP.BRep import BRep_Builder
from OCP.BRepAlgoAPI import BRepAlgoAPI_Defeaturing
from OCP.BRepBndLib import BRepBndLib
from OCP.BRepBuilderAPI import (
    BRepBuilderAPI_Copy,
    BRepBuilderAPI_MakeSolid,
    BRepBuilderAPI_Sewing,
    BRepBuilderAPI_Transform,
)
from OCP.BRepCheck import BRepCheck_Analyzer
from OCP.BRepGProp import BRepGProp
from OCP.BRepPrimAPI import BRepPrimAPI_MakeCylinder
from OCP.Bnd import Bnd_Box
from OCP.GProp import GProp_GProps
from OCP.ShapeUpgrade import ShapeUpgrade_UnifySameDomain
from OCP.TopAbs import TopAbs_FACE, TopAbs_SHELL
from OCP.TopExp import TopExp_Explorer as _Explorer
from OCP.TopoDS import TopoDS, TopoDS_Compound, TopoDS_Shape
from OCP.gp import gp_Ax2, gp_Dir, gp_Pnt, gp_Trsf, gp_Vec

from ..ops import _boolean, keep_compound, OperationError, OpResult, solids_of
from ..tools import Param


TOL = 1e-6


def finish(shape: TopoDS_Shape, cutters=()) -> OpResult:
    """Merge faces that share a surface, check the result, and return it (the selection is not carried over).
    `cutters` are the tool volumes a subtract removed; the preview draws the part of them in empty space as a ghost."""
    copy = BRepBuilderAPI_Copy(shape, False, True)  # UnifySameDomain edits its input in place
    unify = ShapeUpgrade_UnifySameDomain(copy.Shape(), True, True, True)
    unify.Build()
    result = unify.Shape()
    if result.IsNull() or not BRepCheck_Analyzer(result).IsValid():
        raise OperationError("Operation produced invalid geometry")
    return OpResult(result, [], unified=True, cutters=list(cutters))


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


def _compound(shapes: list[TopoDS_Shape]) -> TopoDS_Shape:
    compound = TopoDS_Compound()
    builder = BRep_Builder()
    builder.MakeCompound(compound)
    for shape in shapes:
        builder.Add(compound, shape)
    return compound


def _defeature(topology, selection, what: str) -> OpResult:
    operation = BRepAlgoAPI_Defeaturing()
    operation.SetShape(topology.shape)
    for i in selection.faces:
        operation.AddFaceToRemove(topology.face(i))
    operation.SetRunParallel(True)
    try:
        operation.Build()
    except Exception as e:  # the kernel can raise instead of reporting a failed run
        raise OperationError(f"Could not {what}: the kernel refused ({e})") from e
    if not operation.IsDone() or operation.Shape().IsNull():
        raise OperationError(f"Could not {what}: the neighboring faces cannot be extended to close the gap")
    from ..topology import Topology

    result = operation.Shape()
    if abs(_volume(result) - _volume(topology.shape)) < 1e-9 and Topology(result).face_count == topology.face_count:
        raise OperationError(
            f"Could not {what}: nothing changed because the neighboring faces do not close over this face. "
            "Select a feature such as a pocket, boss, hole or round, not an outside wall of the body"
        )
    return finish(result)


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


def _faces_of(shape):
    explorer = _Explorer(shape, TopAbs_FACE)
    while explorer.More():
        yield explorer.Current()
        explorer.Next()


def combine(shape: TopoDS_Shape, other: TopoDS_Shape, mode: str, offset: gp_Vec | None = None) -> OpResult:
    """Boolean of the model with another solid (mode "union", "cut" or "intersect"), the other optionally moved first."""
    from OCP.BRepAlgoAPI import BRepAlgoAPI_Common

    if mode not in ("union", "cut", "intersect", "add"):
        raise OperationError("mode must be union, cut, intersect or add")
    if offset is not None and offset.Magnitude() > 0:
        other = _moved(other, offset)
    if mode == "add":  # keep it as its own body next to the others, with no boolean
        return finish(_compound(solids_of(shape) + solids_of(other)))
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
    done = finish(result)
    done.shape = keep_compound(shape, done.shape)
    return done

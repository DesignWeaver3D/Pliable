"""Modeling operations on OCCT shapes."""

from dataclasses import dataclass

from OCP.BRepAdaptor import BRepAdaptor_Surface
from OCP.BOPAlgo import BOPAlgo_GlueShift
from OCP.BRepAlgoAPI import BRepAlgoAPI_Cut, BRepAlgoAPI_Fuse
from OCP.BRepBuilderAPI import BRepBuilderAPI_Copy
from OCP.BRepCheck import BRepCheck_Analyzer
from OCP.BRepPrimAPI import BRepPrimAPI_MakePrism
from OCP.GeomAbs import GeomAbs_Plane
from OCP.gp import gp_Dir, gp_Vec
from OCP.ShapeUpgrade import ShapeUpgrade_UnifySameDomain
from OCP.TopAbs import TopAbs_REVERSED
from OCP.TopoDS import TopoDS_Face, TopoDS_Shape
from OCP.collections import List_TopoDS_Shape

MIN_DISTANCE = 1e-4


class OperationError(Exception):
    pass


def planar_normal(face: TopoDS_Face) -> gp_Dir | None:
    """Outward normal of a planar face, or None if the face isn't planar."""
    surface = BRepAdaptor_Surface(face)
    if surface.GetType() != GeomAbs_Plane:
        return None
    normal = surface.Plane().Axis().Direction()
    if face.Orientation() == TopAbs_REVERSED:
        normal = normal.Reversed()
    return normal


@dataclass
class OpResult:
    shape: TopoDS_Shape
    # Faces in the result that the user's selection should follow.
    tracked_faces: list[TopoDS_Face]


def _follow(history_op, shapes: list[TopoDS_Shape]) -> list[TopoDS_Shape]:
    """Map shapes through an operation's Modified/deleted history.

    Works with both BRepBuilderAPI operations (IsDeleted) and BRepTools_History (IsRemoved).
    """
    is_deleted = getattr(history_op, "IsDeleted", None) or history_op.IsRemoved
    result = []
    for shape in shapes:
        modified: List_TopoDS_Shape = history_op.Modified(shape)
        if modified.Size() > 0:
            result.extend(modified)
        elif not is_deleted(shape):
            result.append(shape)
    return result


def _boolean(shape: TopoDS_Shape, tool: TopoDS_Shape, fuse: bool, glue: bool):
    operation = BRepAlgoAPI_Fuse() if fuse else BRepAlgoAPI_Cut()
    arguments, tools = List_TopoDS_Shape(), List_TopoDS_Shape()
    arguments.Append(shape)
    tools.Append(tool)
    operation.SetArguments(arguments)
    operation.SetTools(tools)
    operation.SetRunParallel(True)
    # Never modify the inputs: they belong to the document, and previews run on them repeatedly.
    operation.SetNonDestructive(True)
    if glue:
        operation.SetGlue(BOPAlgo_GlueShift)
    operation.Build()
    if not operation.IsDone() or operation.Shape().IsNull():
        return None
    return operation


def push_pull(shape: TopoDS_Shape, face: TopoDS_Face, distance: float, preview: bool = False) -> OpResult:
    """Extrude a planar face along its outward normal.

    Positive distances add material, negative distances remove it.

    With preview=True the boolean runs in OCCT's "glue" mode, which is several
    times faster on large models because the extrusion shares its base face
    with the solid. Glue mode assumes the extrusion doesn't otherwise
    intersect the solid, so it can be wrong when pushing into other geometry;
    previews accept that risk (falling back if the result is invalid), and
    commits always use the exact boolean.
    """
    normal = planar_normal(face)
    if normal is None:
        raise OperationError("Push/pull currently supports planar faces only")
    if abs(distance) < MIN_DISTANCE:
        return OpResult(shape, [face])

    prism = BRepPrimAPI_MakePrism(face, gp_Vec(normal).Multiplied(distance))
    prism.Build()
    if not prism.IsDone():
        raise OperationError("Could not build extrusion")
    moved_face = prism.LastShape()

    boolean = None
    if preview:
        boolean = _boolean(shape, prism.Shape(), distance > 0, glue=True)
        if boolean is not None and not BRepCheck_Analyzer(boolean.Shape()).IsValid():
            boolean = None
    if boolean is None:
        boolean = _boolean(shape, prism.Shape(), distance > 0, glue=False)
    if boolean is None:
        raise OperationError("Boolean operation failed")
    tracked = _follow(boolean, [moved_face])

    # UnifySameDomain modifies its input in place, even in "safe input" mode,
    # and the boolean result shares sub-shapes with the document's shape.
    # Unifying a topology-only copy keeps the original intact; geometry and
    # triangulations are shared, so the copy is cheap.
    copy = BRepBuilderAPI_Copy(boolean.Shape(), False, True)
    tracked = _follow(copy, tracked)

    unify = ShapeUpgrade_UnifySameDomain(copy.Shape(), True, True, True)
    unify.Build()
    result = unify.Shape()
    tracked = _follow(unify.History(), tracked)

    if result.IsNull() or not BRepCheck_Analyzer(result).IsValid():
        raise OperationError("Operation produced invalid geometry")
    return OpResult(result, tracked)

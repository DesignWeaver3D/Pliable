"""The Stretch tool."""

from OCP.BRep import BRep_Builder, BRep_Tool
from OCP.BRepAdaptor import BRepAdaptor_Curve
from OCP.BRepAlgoAPI import BRepAlgoAPI_Cut, BRepAlgoAPI_Fuse
from OCP.BRepBuilderAPI import (
    BRepBuilderAPI_MakeFace,
    BRepBuilderAPI_MakePolygon,
    BRepBuilderAPI_MakeSolid,
    BRepBuilderAPI_Sewing,
    BRepBuilderAPI_Transform,
)
from OCP.BRepCheck import BRepCheck_Analyzer
from OCP.BRepPrimAPI import BRepPrimAPI_MakePrism
from OCP.BRepTools import BRepTools_WireExplorer
from OCP.GeomAbs import GeomAbs_Line
from OCP.ShapeFix import ShapeFix_Face, ShapeFix_Solid
from OCP.TopAbs import TopAbs_FACE, TopAbs_SHELL, TopAbs_VERTEX, TopAbs_WIRE
from OCP.TopExp import TopExp, TopExp_Explorer
from OCP.TopoDS import TopoDS, TopoDS_Compound
from OCP.collections import IndexedMap_TopoDS_Shape_TopTools_ShapeMapHasher as ShapeIndexedMap
from OCP.gp import gp_Dir, gp_Pln, gp_Pnt, gp_Trsf, gp_Vec

from ..ops import face_handle_point, MIN_DISTANCE, OperationError, OpResult, planar_normal, solids_of
from ..tools import Accepts, Handle, Param, register, Tool


REFUSED = " Try Insert (mode 1), which extrudes the end face's section instead."


def _shapes(shape, kind) -> list:
    found, explorer = [], TopExp_Explorer(shape, kind)
    while explorer.More():
        found.append(explorer.Current())
        explorer.Next()
    return found


def _vertex_set(shape) -> ShapeIndexedMap:
    found = ShapeIndexedMap()
    TopExp.MapShapes_s(shape, TopAbs_VERTEX, found)
    return found


def _touches(face, vertices: ShapeIndexedMap) -> tuple[bool, bool]:
    """(any vertex of the face is in the set, all of them are)."""
    own = _vertex_set(face)
    flags = [vertices.Contains(own.FindKey(k)) for k in range(1, own.Extent() + 1)]
    return any(flags), all(flags)


def _straight(edge) -> bool:
    curve = BRepAdaptor_Curve(edge)
    if curve.GetType() == GeomAbs_Line:
        return True
    first, last = curve.FirstParameter(), curve.LastParameter()
    a, b = curve.Value(first), curve.Value(last)
    chord = a.Distance(b)
    return chord > MIN_DISTANCE and all(
        abs(curve.Value(first + (last - first) * t).Distance(a) - chord * t) < 1e-6 for t in (0.25, 0.5, 0.75)
    )


def _polygon_wires(face):
    """Each wire of a flat face as a list of (vertex, point) in the face's own winding."""
    wires = []
    for wire_shape in _shapes(face, TopAbs_WIRE):
        ring = []
        walk = BRepTools_WireExplorer(TopoDS.Wire(wire_shape), face)
        while walk.More():
            edge = walk.Current()
            if not _straight(edge):
                raise OperationError("A face next to the moved end has curved edges, so it cannot be re-fitted." + REFUSED)
            vertex = TopExp.FirstVertex_s(edge, True)
            ring.append((vertex, BRep_Tool.Pnt_s(vertex)))
            walk.Next()
        wires.append(ring)
    return wires


def _newell(points: list[gp_Pnt]) -> gp_Vec:
    n = gp_Vec(0, 0, 0)
    for a, b in zip(points, points[1:] + points[:1]):
        n.Add(gp_Vec((a.Y() - b.Y()) * (a.Z() + b.Z()), (a.Z() - b.Z()) * (a.X() + b.X()), (a.X() - b.X()) * (a.Y() + b.Y())))
    return n


def _polygon(points: list[gp_Pnt]):
    maker = BRepBuilderAPI_MakePolygon()
    for p in points:
        maker.Add(p)
    maker.Close()
    return maker.Wire()


def _refit(face, shift):
    """A flat face with straight edges, rebuilt through its corners after the moved ones have shifted (`shift` gives a corner's offset, or None)."""
    rings = [[p.Translated(shift(v)) if shift(v) is not None else p for v, p in ring] for ring in _polygon_wires(face)]
    normal = _newell(rings[0])
    if normal.Magnitude() < MIN_DISTANCE:
        raise OperationError("A face next to the moved end would collapse to a line.")
    plane = gp_Pln(rings[0][0], gp_Dir(normal))
    if any(plane.Distance(p) > 1e-5 for ring in rings for p in ring):
        raise OperationError("A face next to the moved end would stop being flat with this move." + REFUSED)
    maker = BRepBuilderAPI_MakeFace(plane, _polygon(rings[0]))
    for ring in rings[1:]:
        maker.Add(_polygon(ring))
    fixer = ShapeFix_Face(maker.Face())
    fixer.Perform()
    return fixer.Face()


def stretch_solid(solid, selected: list, offset: gp_Vec):
    """The solid with the selected faces (and any face attached only to them) moved by `offset`; the rest follows."""
    moved_vertices = ShapeIndexedMap()
    for face in selected:
        own = _vertex_set(face)
        for k in range(1, own.Extent() + 1):
            moved_vertices.Add(own.FindKey(k))
    return shift_vertices(solid, moved_vertices, offset)


def shift_vertices(solid, moved_vertices: ShapeIndexedMap, offset):
    """The solid with the given corners moved by `offset` (one vector, or a function giving each corner's own vector): a face with all its corners
    moved by one vector moves, a face with some is re-fitted through its corners."""
    shift = offset if callable(offset) else (lambda v: offset if moved_vertices.Contains(v) else None)
    faces = [TopoDS.Face(f) for f in _shapes(solid, TopAbs_FACE)]
    sewing = BRepBuilderAPI_Sewing(1e-6)
    moving = 0
    for face in faces:
        any_moved, all_moved = _touches(face, moved_vertices)
        if all_moved and not callable(offset):
            moving += 1
            transform = gp_Trsf()
            transform.SetTranslation(offset)
            sewing.Add(BRepBuilderAPI_Transform(face, transform, True).Shape())
        elif any_moved:
            sewing.Add(_refit(face, shift))
        else:
            sewing.Add(face)
    if moving == len(faces):
        raise OperationError("Every face is selected, which is a move, not a stretch")
    sewing.Perform()
    shells = _shapes(sewing.SewedShape(), TopAbs_SHELL)
    if not shells:
        raise OperationError("The faces could not be joined again after the move." + REFUSED)
    fixer = ShapeFix_Solid(BRepBuilderAPI_MakeSolid(TopoDS.Shell(shells[0])).Solid())
    fixer.Perform()
    result = fixer.Solid()
    from ..shared.solids import _volume
    if _volume(result) <= 0 or not BRepCheck_Analyzer(result).IsValid():
        raise OperationError("The stretched solid is not valid." + REFUSED)
    return result


def insert_solid(solid, end_face, offset: gp_Vec):
    """Extend (or shorten) the solid at a flat end face by extruding that section along the offset."""
    normal = planar_normal(end_face)
    if normal is None:
        raise OperationError("Insert needs a flat end face")
    along = gp_Vec(normal).Dot(offset)
    if abs(along) < MIN_DISTANCE or (offset - gp_Vec(normal).Multiplied(along)).Magnitude() > 1e-6:
        raise OperationError("Insert moves the end straight along its normal; the offset must be in that direction")
    prism = BRepPrimAPI_MakePrism(end_face, offset).Shape()
    operation = BRepAlgoAPI_Fuse(solid, prism) if along > 0 else BRepAlgoAPI_Cut(solid, prism)
    operation.Build()
    if not operation.IsDone() or operation.Shape().IsNull():
        raise OperationError("Could not insert along this end")
    return operation.Shape()


@register
class Stretch(Tool):
    """Move the selected end faces by (dx, dy, dz); neighboring faces are re-fitted so the end keeps its size
    (mode 0), or the end's section is extruded or cut straight along its normal (mode 1)."""

    id = "stretch"
    label = "Stretch"
    description = "Moves the end faces you select by a distance and re-fits the faces joined to them, so the part gets longer or shorter without cutting. Select the faces at one end; mode 0 re-fits the sides, mode 1 extrudes the end's section."
    accepts = Accepts(faces=(1, None))
    params = [Param("dx", "length"), Param("dy", "length"), Param("dz", "length"), Param("mode", "number")]

    def handles(self, topology, selection, values):
        # Three move arrows (X, Y, Z) at the middle of the selected end faces, at their moved position (as on Move hole / boss).
        points = [face_handle_point(topology.face(i)) for i in selection.faces]
        centre = [sum(p.Coord(k + 1) for p in points) / len(points) for k in range(3)]
        now = (values["dx"], values["dy"], values["dz"])
        at = tuple(c + n for c, n in zip(centre, now))
        return [Handle(name, f"Stretch along {label}", at, axis, kind="move") for name, label, axis in (("dx", "X", (1, 0, 0)), ("dy", "Y", (0, 1, 0)), ("dz", "Z", (0, 0, 1)))]

    def run(self, topology, selection, values, preview):
        offset = gp_Vec(values["dx"], values["dy"], values["dz"])
        if offset.Magnitude() < MIN_DISTANCE:
            return OpResult(topology.shape, [])
        mode = int(round(values["mode"]))
        if mode not in (0, 1):
            raise OperationError("Mode must be 0 (stretch) or 1 (insert)")
        selected = [topology.face(i) for i in selection.faces]
        body = next((s for s in solids_of(topology.shape) if all(any(f.IsSame(o) for o in _shapes(s, TopAbs_FACE)) for f in selected)), None)
        if body is None:
            raise OperationError("Select faces that all belong to one solid")
        if mode == 1 and len(selected) != 1:
            raise OperationError("Insert takes one flat end face")
        if mode == 0:
            try:
                changed = stretch_solid(body, selected, offset)
            except OperationError:
                # A flat end moved straight along its normal gives the same shape whether the sides are re-fitted or the section is extruded,
                # so when the sides cannot be re-fitted (curved neighbors, such as fillets) the extrusion is used instead of refusing.
                normal = planar_normal(selected[0]) if len(selected) == 1 else None
                if normal is None or (offset - gp_Vec(normal).Multiplied(gp_Vec(normal).Dot(offset))).Magnitude() > 1e-6:
                    raise
                changed = insert_solid(body, selected[0], offset)
        else:
            changed = insert_solid(body, selected[0], offset)
        from ..shared.solids import finish
        compound, builder = TopoDS_Compound(), BRep_Builder()
        builder.MakeCompound(compound)
        for solid in solids_of(topology.shape):
            builder.Add(compound, changed if solid.IsSame(body) else solid)
        if len(solids_of(topology.shape)) == 1 and mode == 1:
            return finish(changed)
        return finish(compound)

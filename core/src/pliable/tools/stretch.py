"""The Stretch tool."""

import numpy as np
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
from ..facemerge import merge_faces
from ..stretch.falloff import CURVATURE, TANGENT
from ..stretch.frame import frame_axes, FRAMES, pivot_point, PIVOTS, rigid_move
from ..stretch.gizmo import band_handle, move_and_tilt_handles, reach_of
from ..stretch.solve import plan, stretch
from ..tools import Accepts, Param, register, Tool
from ..validity import is_valid


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
    if _volume(result) <= 0 or not is_valid(result):
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


def _owner(shape, items: list):
    """The solid of the shape that holds every one of the items (None when they are spread over several)."""
    for solid in solids_of(shape):
        inside = ShapeIndexedMap()
        TopExp.MapShapes_s(solid, inside)
        if all(inside.Contains(item) for item in items):
            return solid
    return None


@register
class Stretch(Tool):
    """Move the selected faces, edges and vertices as one rigid piece (a shift along the frame's axes and a tilt about
    them); the faces joining them to the rest deform over a band beside them (mode 0), or a flat end's section is
    extruded or cut straight along its normal (mode 1)."""

    id = "stretch"
    label = "Stretch"
    description = (
        "Moves the part you select as one rigid piece while the faces joining it to the rest stretch like rubber, so the part gets longer, shorter or bent without cutting. "
        "Box-select an end (or pick its faces, edges or points), then drag the arrows to move it, the rings to tilt it and the slider to size the band that deforms; "
        "holes and other features beyond the band stay where they are. Mode 1 extrudes a flat end's section instead."
    )
    accepts = Accepts(faces=(0, None), edges=(0, None), vertices=(0, None), any_of=True)
    params = [
        Param("dx", "length"),
        Param("dy", "length"),
        Param("dz", "length"),
        Param("mode", "number"),
        Param("rx", "angle"),
        Param("ry", "angle"),
        Param("rz", "angle"),
        Param("frame", "number", options=FRAMES),
        Param("fx", "number"),
        Param("fy", "number"),
        Param("fz", "number"),
        Param("frame_edge", "number", -1),
        Param("fa", "angle"),
        Param("fb", "angle"),
        Param("fc", "angle"),
        Param("pivot", "number", options=PIVOTS),
        Param("px", "length"),
        Param("py", "length"),
        Param("pz", "length"),
        Param("band", "length"),
        Param("continuity", "number", options=("G1 (tangent)", "G2 (curvature)")),
    ]

    def _picked(self, topology, selection):
        faces = [topology.face(i) for i in selection.faces]
        edges = [topology.edge(i) for i in selection.edges]
        vertices = [topology.vertex(i) for i in selection.vertices]
        body = _owner(topology.shape, faces + edges + vertices)
        if body is None:
            raise OperationError("Select faces, edges and points that all belong to one solid")
        return body, faces, edges, vertices

    def _plan(self, topology, selection, band: float):
        """The zones and band for this selection, kept with the model so every step of a drag does not work them out again."""
        kept = topology.__dict__.setdefault("_stretch_plans", {})
        key = (tuple(selection.faces), tuple(selection.edges), tuple(selection.vertices), band)
        if key not in kept:
            kept.clear()
            kept[key] = plan(*self._picked(topology, selection), band)
        return kept[key]

    def handles(self, topology, selection, values):
        # Move arrows and tilt rings at the pivot (as on Move/Rotate), in the chosen frame, and the band's slider.
        try:
            made = self._plan(topology, selection, values.get("band", 0.0))
        except OperationError:
            made = None
        if made is not None:
            centre, reach = made.centre, reach_of(made)
        elif selection.faces:
            points = [face_handle_point(topology.face(i)) for i in selection.faces]
            centre, reach = np.array([sum(p.Coord(k + 1) for p in points) / len(points) for k in range(3)]), 0.0
        else:
            return []
        axes = frame_axes(values, topology)
        here = pivot_point(values, centre) + values["dx"] * axes[0] + values["dy"] * axes[1] + values["dz"] * axes[2]
        out = move_and_tilt_handles(axes, here, reach, values)
        if made is not None and int(round(values.get("mode", 0))) == 0:
            out.append(band_handle(made, [topology.face_id(made.body.faces[f]) for f in sorted(made.zones.rubber)]))
        return out

    def run(self, topology, selection, values, preview):
        offset = gp_Vec(values["dx"], values["dy"], values["dz"])
        tilted = any(abs(values[n]) > 1e-9 for n in ("rx", "ry", "rz"))
        if offset.Magnitude() < MIN_DISTANCE and not tilted:
            return OpResult(topology.shape, [])
        mode = int(round(values["mode"]))
        if mode not in (0, 1):
            raise OperationError("Mode must be 0 (stretch) or 1 (insert)")
        body, faces, edges, vertices = self._picked(topology, selection)
        if mode == 1 and len(faces) != 1:
            raise OperationError("Insert takes one flat end face")
        axes = frame_axes(values, topology)
        shift = values["dx"] * axes[0] + values["dy"] * axes[1] + values["dz"] * axes[2]
        offset = gp_Vec(*map(float, shift))
        tracked, notes = ([], [], []), []
        if mode == 0:
            try:
                order = CURVATURE if int(round(values["continuity"])) == 1 else TANGENT
                done = stretch(body, faces, edges, vertices, lambda made: rigid_move(values, axes, pivot_point(values, made.centre)), values["band"], order, not preview, self._plan(topology, selection, values["band"]))
                changed, tracked = done.solid, (done.faces, done.edges, done.vertices)
                if done.removed:
                    notes.append(f"Removed {done.removed} feature{'' if done.removed == 1 else 's'} the moved end ran over")
                if done.freeform:
                    notes.append(f"{done.freeform} face{'' if done.freeform == 1 else 's'} became free-form")
            except OperationError:
                # A flat end moved straight along its normal can still be extruded or cut when the faces beside it cannot be stretched.
                normal = planar_normal(faces[0]) if len(faces) == 1 and not tilted else None
                if normal is None or (offset - gp_Vec(normal).Multiplied(gp_Vec(normal).Dot(offset))).Magnitude() > 1e-6:
                    raise
                changed = insert_solid(body, faces[0], offset)
        else:
            changed = insert_solid(body, faces[0], offset)
        solids = solids_of(topology.shape)
        if len(solids) == 1:
            shape = changed
        else:
            shape, builder = TopoDS_Compound(), BRep_Builder()
            builder.MakeCompound(shape)
            for solid in solids:
                builder.Add(shape, changed if solid.IsSame(body) else solid)
        result = merge_faces(OpResult(shape, *tracked))
        result.notice = "; ".join(notes) or None
        return result

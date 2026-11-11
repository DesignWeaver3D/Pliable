"""Running a tool on only the bodies its selection belongs to.

The scene is one compound of bodies (a solid, or a compound body grouping several solids; see `ops.solids_of`). A tool
that declares `scope_to_bodies` is given only the bodies that own its selected faces, edges, vertices or chosen body
rows, so a body lying on top of another one (a copy) or beside it cannot disturb the operation. The other bodies come
back untouched, with the same shapes. Face, edge and vertex ids stay global: `narrow` renumbers the selection for the
tool and `Narrowed.widen` puts the result back into the whole scene.

A tool that merges into or cuts the bodies it meets declares `skips_hidden_bodies` instead: it sees its own bodies and
the visible ones, and the hidden bodies (the ids the app sends in `topology.hidden_bodies`) stay out of it.
"""

from dataclasses import dataclass, field, replace

from OCP.BRep import BRep_Builder
from OCP.BRepBndLib import BRepBndLib
from OCP.Bnd import Bnd_Box
from OCP.TopAbs import TopAbs_EDGE, TopAbs_FACE, TopAbs_VERTEX
from OCP.TopExp import TopExp
from OCP.TopoDS import TopoDS_Compound, TopoDS_Shape
from OCP.collections import IndexedMap_TopoDS_Shape_TopTools_ShapeMapHasher as ShapeIndexedMap

from .bodies import BodyState
from .ops import OperationError, OpResult, solids_of
from .topology import Topology


def _compound(shapes: list[TopoDS_Shape]) -> TopoDS_Shape:
    compound, builder = TopoDS_Compound(), BRep_Builder()
    builder.MakeCompound(compound)
    for shape in shapes:
        builder.Add(compound, shape)
    return compound


def _owner_of(solids: list[TopoDS_Shape], kind, shape: TopoDS_Shape) -> int | None:
    """Index of the body that holds `shape` (a face, edge or vertex of the scene)."""
    for index, solid in enumerate(solids):
        found = ShapeIndexedMap()
        TopExp.MapShapes_s(solid, kind, found)
        if found.Contains(shape):
            return index
    return None


class _LooseSet:
    """Membership of a shape among faces by identity (`in` on a plain list would compare with ==)."""

    def __init__(self, faces):
        self.faces = faces

    def __contains__(self, shape) -> bool:
        return any(shape.IsSame(f) for f in self.faces)


def _owning(topology: Topology, selection, solids: list[TopoDS_Shape]) -> set[int] | None:
    """Indices of the bodies holding the selected faces, edges, vertices and body rows; None when one cannot be found."""
    state = topology.bodies
    found: set[int] = set()
    loose = _LooseSet(_loose_faces(topology, solids))
    for ids, kind, get in ((selection.faces, TopAbs_FACE, topology.face), (selection.edges, TopAbs_EDGE, topology.edge), (selection.vertices, TopAbs_VERTEX, topology.vertex)):
        for i in ids:
            index = _owner_of(solids, kind, get(i))
            if index is None:
                if kind == TopAbs_FACE and get(i) in loose:
                    continue  # a loose face (sketch region) belongs to no body
                return None
            found.add(index)
    for body_id in selection.bodies:
        index = state.find(body_id)
        if index is None:
            return None
        found.add(index)
    return found


def _loose_faces(topology: Topology, solids: list[TopoDS_Shape]) -> list[TopoDS_Shape]:
    """The faces of the scene that no solid holds (sketch regions), in scene order."""
    return _faces_outside(topology.shape, solids)


def _faces_outside(shape: TopoDS_Shape, solids: list[TopoDS_Shape]) -> list[TopoDS_Shape]:
    held = ShapeIndexedMap()
    for solid in solids:
        TopExp.MapShapes_s(solid, TopAbs_FACE, held)
    every = ShapeIndexedMap()
    TopExp.MapShapes_s(shape, TopAbs_FACE, every)
    return [every.FindKey(i) for i in range(1, every.Extent() + 1) if not held.Contains(every.FindKey(i))]


def _chosen(topology: Topology, selection, solids: list[TopoDS_Shape], strict: bool, loose: bool = False, hold: bool = False) -> list[int] | None:
    """The bodies a tool is given, in scene order, or None when it should see the whole scene. `strict`: only the bodies
    that own the selection (nothing selected means the whole scene). Otherwise: those and every visible body. With loose
    faces in the scene a single hidden body is worth leaving out, and the result may be no body at all (only loose faces)."""
    state = topology.bodies
    if (len(solids) < 2 and not loose) or len(solids) != len(state.bodies):
        return None
    found = _owning(topology, selection, solids)
    if found is None:
        return None
    if strict:
        pool = found
    else:
        hidden = {i for i in (state.find(b) for b in getattr(topology, "hidden_bodies", ())) if i is not None}
        pool = found | (set(range(len(solids))) - hidden)
    if (len(pool) == len(solids) and not hold) or (not pool and not (loose and not strict)):
        return None
    return sorted(pool)


@dataclass
class Narrowed:
    """The tool's view of the scene (`topology`, `selection`) plus what is needed to put its result back."""

    topology: Topology
    selection: object
    scene: Topology
    solids: list[TopoDS_Shape]
    chosen: list[int]
    left_out: list[TopoDS_Shape]  # the hidden bodies this run did not see
    loose_faces: list[TopoDS_Shape] = field(default_factory=list)  # the sketch regions that went into the run with the bodies
    held_out: list[TopoDS_Shape] = field(default_factory=list)  # the sketch regions the run did not see (they come back as they were)

    def values(self, values: dict) -> dict:
        """The tool's values with a face id they carry (the `target` of Up to face) renumbered for the narrowed scene."""
        if "target" not in values:
            return values
        try:
            mine = self.topology.face_id(self.scene.face(int(values["target"])))
        except KeyError:
            return values  # not a face of the model: the tool reports it
        if mine is None:
            raise OperationError("The target face is in a hidden body; show it or choose another face")
        return {**values, "target": mine}

    def widen(self, result: OpResult) -> OpResult:
        """`result` with its shape replaced by the whole scene: the other bodies as they were, the tool's bodies replaced
        by what it made (at the place of the first body it worked on)."""
        made = solids_of(result.shape)
        made_loose = _faces_outside(result.shape, made)  # what the tool left of the loose faces, and any it made
        first = self.chosen[0] if self.chosen else len(self.solids)
        pieces: list[TopoDS_Shape] = []
        for index, solid in enumerate(self.solids):
            if index == first:
                pieces.extend(made)
                pieces.extend(made_loose)
            if index not in self.chosen:
                pieces.append(solid)
        if first == len(self.solids):
            pieces.extend(made)
            pieces.extend(made_loose)
        pieces.extend(self.held_out)
        result.shape = _compound(pieces)
        if result.notice is None and self.left_out and self._meets(result.shape):
            count = len(self.left_out)
            result.notice = f"Ignored {count} hidden bod{'y' if count == 1 else 'ies'} touching the change"
        if result.moved:  # keyed by the index of the solid in the tool's input
            result.moved = {self.chosen[k]: v for k, v in result.moved.items()}
        return result


    def _meets(self, shape: TopoDS_Shape) -> bool:
        """Whether the bounding box of a left-out body overlaps that of the result (a cheap test for the status note)."""
        mine = Bnd_Box()
        BRepBndLib.Add_s(shape, mine)
        for solid in self.left_out:
            box = Bnd_Box()
            BRepBndLib.Add_s(solid, box)
            if not mine.IsOut(box):
                return True
        return False


def narrow(topology: Topology, selection, strict: bool = True) -> Narrowed | None:
    """The scene reduced to the bodies a tool is given (see `_chosen`) plus every loose face (sketch region), or None when
    the tool should see all of it."""
    solids = solids_of(topology.shape)
    loose = _loose_faces(topology, solids)
    # A tool that merges into the bodies it meets, or one working on a region, gets the loose faces; a strictly scoped tool
    # working on a body does not (a shell or fillet has no use for them) and they come back as they were.
    hold = bool(loose) and strict and not any(topology.face(i).IsSame(f) for i in selection.faces for f in loose)
    chosen = _chosen(topology, selection, solids, strict, bool(loose), hold)
    if chosen is None:
        return None
    state = topology.bodies
    inner = Topology(_compound([solids[i] for i in chosen] + ([] if hold else loose)), BodyState(tuple(state.bodies[i] for i in chosen), state.next_id, state.counts))
    inner.datums = getattr(topology, "datums", None)
    renumbered = {}
    for field_name, get, find in (("faces", topology.face, inner.face_id), ("edges", topology.edge, inner.edge_id), ("vertices", topology.vertex, inner.vertex_id)):
        ids = [find(get(i)) for i in getattr(selection, field_name)]
        if any(i is None for i in ids):
            return None
        renumbered[field_name] = ids
    return Narrowed(inner, replace(selection, **renumbered), topology, solids, chosen, [solids[i] for i in range(len(solids)) if i not in chosen], [] if hold else loose, loose if hold else [])

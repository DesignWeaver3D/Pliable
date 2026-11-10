"""Running a tool on only the bodies its selection belongs to.

The scene is one compound of bodies (a solid, or a compound body grouping several solids; see `ops.solids_of`). A tool
that declares `scope_to_bodies` is given only the bodies that own its selected faces, edges, vertices or chosen body
rows, so a body lying on top of another one (a copy) or beside it cannot disturb the operation. The other bodies come
back untouched, with the same shapes. Face, edge and vertex ids stay global: `narrow` renumbers the selection for the
tool and `Narrowed.widen` puts the result back into the whole scene.

A tool that merges into or cuts the bodies it meets declares `skips_hidden_bodies` instead: it sees its own bodies and
the visible ones, and the hidden bodies (the ids the app sends in `topology.hidden_bodies`) stay out of it.
"""

from dataclasses import dataclass, replace

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


def _owning(topology: Topology, selection, solids: list[TopoDS_Shape]) -> set[int] | None:
    """Indices of the bodies holding the selected faces, edges, vertices and body rows; None when one cannot be found."""
    state = topology.bodies
    found: set[int] = set()
    for ids, kind, get in ((selection.faces, TopAbs_FACE, topology.face), (selection.edges, TopAbs_EDGE, topology.edge), (selection.vertices, TopAbs_VERTEX, topology.vertex)):
        for i in ids:
            index = _owner_of(solids, kind, get(i))
            if index is None:
                return None
            found.add(index)
    for body_id in selection.bodies:
        index = state.find(body_id)
        if index is None:
            return None
        found.add(index)
    return found


def _chosen(topology: Topology, selection, solids: list[TopoDS_Shape], strict: bool) -> list[int] | None:
    """The bodies a tool is given, in scene order, or None when it should see the whole scene. `strict`: only the bodies
    that own the selection (nothing selected means the whole scene). Otherwise: those and every visible body."""
    state = topology.bodies
    if len(solids) < 2 or len(solids) != len(state.bodies):
        return None
    found = _owning(topology, selection, solids)
    if found is None:
        return None
    if strict:
        pool = found
    else:
        hidden = {i for i in (state.find(b) for b in getattr(topology, "hidden_bodies", ())) if i is not None}
        pool = found | (set(range(len(solids))) - hidden)
    if not pool or len(pool) == len(solids):
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
        pieces: list[TopoDS_Shape] = []
        for index, solid in enumerate(self.solids):
            if index == self.chosen[0]:
                pieces.extend(made)
            elif index not in self.chosen:
                pieces.append(solid)
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
    """The scene reduced to the bodies a tool is given (see `_chosen`), or None when the tool should see all of it."""
    solids = solids_of(topology.shape)
    chosen = _chosen(topology, selection, solids, strict)
    if chosen is None:
        return None
    state = topology.bodies
    inner = Topology(_compound([solids[i] for i in chosen]), BodyState(tuple(state.bodies[i] for i in chosen), state.next_id, state.counts))
    inner.datums = getattr(topology, "datums", None)
    renumbered = {}
    for field, get, find in (("faces", topology.face, inner.face_id), ("edges", topology.edge, inner.edge_id), ("vertices", topology.vertex, inner.vertex_id)):
        ids = [find(get(i)) for i in getattr(selection, field)]
        if any(i is None for i in ids):
            return None
        renumbered[field] = ids
    return Narrowed(inner, replace(selection, **renumbered), topology, solids, chosen, [solids[i] for i in range(len(solids)) if i not in chosen])

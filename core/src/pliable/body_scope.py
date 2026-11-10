"""Running a tool on only the bodies its selection belongs to.

The scene is one compound of bodies (a solid, or a compound body grouping several solids; see `ops.solids_of`). A tool
that declares `scope_to_bodies` is given only the bodies that own its selected faces, edges, vertices or chosen body
rows, so a body lying on top of another one (a copy) or beside it cannot disturb the operation. The other bodies come
back untouched, with the same shapes. Face, edge and vertex ids stay global: `narrow` renumbers the selection for the
tool and `Narrowed.widen` puts the result back into the whole scene.
"""

from dataclasses import dataclass, replace

from OCP.BRep import BRep_Builder
from OCP.TopAbs import TopAbs_EDGE, TopAbs_FACE, TopAbs_VERTEX
from OCP.TopExp import TopExp
from OCP.TopoDS import TopoDS_Compound, TopoDS_Shape
from OCP.collections import IndexedMap_TopoDS_Shape_TopTools_ShapeMapHasher as ShapeIndexedMap

from .bodies import BodyState
from .ops import OpResult, solids_of
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


def owners(topology: Topology, selection) -> list[int] | None:
    """Indices of the bodies the selection belongs to, in scene order; None when the tool should see the whole scene
    (nothing selected, a selection that spans every body, a single body, or a scene whose bodies cannot be told apart)."""
    state = topology.bodies
    solids = solids_of(topology.shape)
    if len(solids) < 2 or len(solids) != len(state.bodies):
        return None
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
    if not found or len(found) == len(solids):
        return None
    return sorted(found)


@dataclass
class Narrowed:
    """The tool's view of the scene (`topology`, `selection`) plus what is needed to put its result back."""

    topology: Topology
    selection: object
    scene: Topology
    solids: list[TopoDS_Shape]
    chosen: list[int]

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
        if result.moved:  # keyed by the index of the solid in the tool's input
            result.moved = {self.chosen[k]: v for k, v in result.moved.items()}
        return result


def narrow(topology: Topology, selection) -> Narrowed | None:
    """The scene reduced to the bodies the selection belongs to, or None when the tool should see all of it."""
    chosen = owners(topology, selection)
    if chosen is None:
        return None
    solids = solids_of(topology.shape)
    state = topology.bodies
    inner = Topology(_compound([solids[i] for i in chosen]), BodyState(tuple(state.bodies[i] for i in chosen), state.next_id, state.counts))
    inner.datums = getattr(topology, "datums", None)
    renumbered = {}
    for field, get, find in (("faces", topology.face, inner.face_id), ("edges", topology.edge, inner.edge_id), ("vertices", topology.vertex, inner.vertex_id)):
        ids = [find(get(i)) for i in getattr(selection, field)]
        if any(i is None for i in ids):
            return None
        renumbered[field] = ids
    return Narrowed(inner, replace(selection, **renumbered), topology, solids, chosen)

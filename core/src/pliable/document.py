"""The open model and its undo/redo history."""

import copy

from OCP.BRep import BRep_Builder
from OCP.BRepBuilderAPI import BRepBuilderAPI_Copy
from OCP.TopoDS import TopoDS_Compound, TopoDS_Shape

from . import bodies as body_ids
from . import recipes
from .bodies import BodyState
from .ops import solids_of
from .projectfile import Project
from .topology import Topology

MAX_HISTORY = 50  # states kept for undo; also the number of autosave snapshots


def _compound(shapes: list[TopoDS_Shape]) -> TopoDS_Shape:
    compound = TopoDS_Compound()
    builder = BRep_Builder()
    builder.MakeCompound(compound)
    for shape in shapes:
        builder.Add(compound, shape)
    return compound


class Document:
    def __init__(self, shape: TopoDS_Shape, name: str = "Untitled", bodies: BodyState | None = None):
        self.name = name
        self._history: list[Topology] = [Topology(shape, bodies if bodies is not None else body_ids.fresh(shape))]
        self._ids: list[int] = [0]  # stable id per state, names its autosave file
        self._sketches: list[list[dict]] = [[]]  # kept sketches per state: {id, name, rev, sketch}; never mutated in place
        self._sketch_next = 1  # next sketch id; ids are never reused
        self._datums: list[list[dict]] = [[]]  # datum planes per state: {id, name, plane}; never mutated in place
        self._datum_next = 1  # next datum id; ids are never reused
        self._mirrors: list[dict | None] = [None]  # mirror mode per state: {name, plane} while on, else None
        self._next_id = 1
        self._index = 0
        self.other_objects: dict = {}  # object types of a project file this release does not know, kept for saving again

    @classmethod
    def from_states(cls, shapes: list[TopoDS_Shape], ids: list[int], index: int, name: str, bodies: list[BodyState] | None = None, sketches: list[list[dict]] | None = None, sketch_next: int | None = None, other: dict | None = None, datums: list[list[dict]] | None = None, datum_next: int | None = None, mirrors: list | None = None) -> "Document":
        """Rebuild a document from autosaved states (oldest first)."""
        document = cls(shapes[0], name)
        document.other_objects = copy.deepcopy(other or {})
        if bodies is None or len(bodies) != len(shapes):
            bodies = [body_ids.fresh(s) for s in shapes]
        document._history = [Topology(s, b) for s, b in zip(shapes, bodies)]
        document._ids = list(ids)
        document._next_id = max(ids) + 1
        document._index = index
        if sketches is not None and len(sketches) == len(shapes):
            document._sketches = copy.deepcopy(sketches)
        else:
            document._sketches = [[] for _ in shapes]
        used = max((e["id"] for state in document._sketches for e in state), default=0)
        document._sketch_next = max(int(sketch_next or 1), used + 1)
        if datums is not None and len(datums) == len(shapes):
            document._datums = copy.deepcopy(datums)
        else:
            document._datums = [[] for _ in shapes]
        document._mirrors = list(mirrors) if mirrors is not None and len(mirrors) == len(shapes) else [None for _ in shapes]
        used = max((e["id"] for state in document._datums for e in state), default=0)
        document._datum_next = max(int(datum_next or 1), used + 1)
        return document

    @property
    def current(self) -> Topology:
        return self._history[self._index]

    @property
    def ids(self) -> list[int]:
        return list(self._ids)

    @property
    def body_states(self) -> list[BodyState]:
        return [t.bodies for t in self._history]

    @property
    def index(self) -> int:
        return self._index

    @property
    def sketch_states(self) -> list[list[dict]]:
        return copy.deepcopy(self._sketches)

    @property
    def sketch_next(self) -> int:
        return self._sketch_next

    @property
    def sketches(self) -> list[dict]:
        """The kept sketches of the current state (copies)."""
        return copy.deepcopy(self._sketches[self._index])

    def sketch_list(self) -> list[dict]:
        return [{"id": e["id"], "name": e["name"], "rev": e["rev"]} for e in self._sketches[self._index]]

    @property
    def datum_next(self) -> int:
        return self._datum_next

    def datum_list(self) -> list[dict]:
        """The datum planes of the current state (copies)."""
        return copy.deepcopy(self._datums[self._index])

    @property
    def mirror(self) -> dict | None:
        """Mirror mode of the current state: `{name, plane}` while on, else None."""
        return copy.deepcopy(self._mirrors[self._index])

    def set_mirror(self, mirror: dict | None) -> Topology:
        """Turn mirror mode on (for a plane) or off as an undoable step; the shape is unchanged."""
        return self._push(self.current.shape, self.current.bodies, None, None, mirror, True)

    def new_datum_id(self) -> int:
        n = self._datum_next
        self._datum_next += 1
        return n

    def set_datums(self, datums: list[dict]) -> Topology:
        """Record a new state with the same shape, bodies and sketches and a changed datum plane list."""
        return self._push(self.current.shape, self.current.bodies, None, datums)

    def get_sketch(self, sketch_id: int) -> dict | None:
        for e in self._sketches[self._index]:
            if e["id"] == sketch_id:
                return copy.deepcopy(e)
        return None

    def new_sketch_id(self) -> int:
        """Reserve the next sketch id (never reused, even after undo)."""
        n = self._sketch_next
        self._sketch_next += 1
        return n

    def shape_of(self, state_id: int) -> TopoDS_Shape:
        return self._history[self._ids.index(state_id)].shape

    def project_of(self, state_id: int) -> Project:
        """One state as a project (shape, bodies, sketches); the snapshot is safe to pack on another thread."""
        i = self._ids.index(state_id)
        return Project(self._history[i].shape, self._history[i].bodies, self.name, copy.deepcopy(self._sketches[i]), self._sketch_next, copy.deepcopy(self._datums[i]), self._datum_next, copy.deepcopy(self._mirrors[i]), copy.deepcopy(self.other_objects))

    def to_project(self) -> Project:
        return self.project_of(self._ids[self._index])

    @classmethod
    def from_project(cls, project: Project) -> "Document":
        """A new document (no undo history) holding a saved project."""
        document = cls(project.shape, project.name, project.bodies)
        document._sketches = [copy.deepcopy(project.sketches)]
        used = max((e["id"] for e in project.sketches), default=0)
        document._sketch_next = max(project.sketch_next, used + 1)
        document.other_objects = copy.deepcopy(project.other)
        document._datums = [copy.deepcopy(project.datums)]
        document._mirrors = [copy.deepcopy(project.mirror)]
        document._datum_next = max(project.datum_next, max((e["id"] for e in project.datums), default=0) + 1)
        return document

    def _bodies_for(self, shape: TopoDS_Shape, kind: str, ordered: bool, names, change: dict | None) -> BodyState:
        """The bodies after an operation: matched to the new solids, then their primitive recipes brought up to date.
        `change` holds `cause` (name of the operation), `combined`, `moved` and `assign` (see recipes.settle)."""
        prev = self.current.bodies
        state = body_ids.carry(prev, self.current.shape, shape, kind, ordered, names)
        return recipes.settle(prev, state, shape, **(change or {"cause": "a later change"}))

    def preview(self, shape: TopoDS_Shape, kind: str = body_ids.DEFAULT_KIND, ordered: bool = False, change: dict | None = None) -> Topology:
        """A topology for a result that is not committed; its bodies are matched like a commit's, nothing is recorded."""
        return Topology(shape, self._bodies_for(shape, kind, ordered, None, change))

    def commit(self, shape: TopoDS_Shape, kind: str = body_ids.DEFAULT_KIND, ordered: bool = False, names: list | None = None, change: dict | None = None, sketches: list[dict] | None = None) -> Topology:
        """Add a state for `shape`; the bodies of the current state are carried over to it (see bodies.py).
        The kept sketches are carried over too unless `sketches` gives the new list."""
        return self._push(shape, self._bodies_for(shape, kind, ordered, names, change), sketches)

    def set_sketches(self, sketches: list[dict]) -> Topology:
        """Record a new state with the same shape and bodies and a changed sketch list."""
        return self._push(self.current.shape, self.current.bodies, sketches)

    def rename_body(self, body_id: int, name: str) -> Topology:
        """Rename a body as an undoable step (the shape is unchanged)."""
        return self._push(self.current.shape, body_ids.renamed(self.current.bodies, body_id, name))

    def delete_body(self, body_id: int) -> Topology:
        """Remove one body as an undoable step."""
        state = self.current.bodies
        index = state.find(body_id)
        solids = solids_of(self.current.shape)
        if index is None or len(solids) != len(state.bodies):
            raise KeyError(body_id)
        del solids[index]
        bodies = BodyState(state.bodies[:index] + state.bodies[index + 1 :], state.next_id, state.counts)
        return self._push(_compound(solids), bodies)

    def delete_bodies(self, ids: list[int]) -> Topology:
        """Remove several bodies as one undoable step."""
        state = self.current.bodies
        solids = solids_of(self.current.shape)
        if len(solids) != len(state.bodies) or not ids or len(set(ids)) != len(ids):
            raise KeyError(ids)
        drop = set()
        for body_id in ids:
            index = state.find(body_id)
            if index is None:
                raise KeyError(body_id)
            drop.add(index)
        keep = [i for i in range(len(solids)) if i not in drop]
        bodies = BodyState(tuple(state.bodies[i] for i in keep), state.next_id, state.counts)
        return self._push(_compound([solids[i] for i in keep]), bodies)

    def duplicate_body(self, body_id: int) -> tuple[Topology, int]:
        """Add a copy of one body, in the same place, named after it; returns the new state and the copy's id."""
        state = self.current.bodies
        index = state.find(body_id)
        solids = solids_of(self.current.shape)
        if index is None or len(solids) != len(state.bodies):
            raise KeyError(body_id)
        twin = BRepBuilderAPI_Copy(solids[index], True).Shape()
        name = f"{state.bodies[index].name} copy"[:80]
        bodies = BodyState(state.bodies + (body_ids.Body(state.next_id, name),), state.next_id + 1, state.counts)
        return self._push(_compound(solids + [twin]), bodies), state.next_id

    def _push(self, shape: TopoDS_Shape, bodies: BodyState, sketches: list[dict] | None = None, datums: list[dict] | None = None, mirror: dict | None = None, set_mirror: bool = False) -> Topology:
        kept = self._sketches[self._index] if sketches is None else copy.deepcopy(sketches)
        kept_datums = self._datums[self._index] if datums is None else copy.deepcopy(datums)
        del self._datums[self._index + 1 :]
        self._datums.append(kept_datums)
        del self._mirrors[self._index + 1 :]
        self._mirrors.append(copy.deepcopy(mirror) if set_mirror else self._mirrors[self._index])
        del self._sketches[self._index + 1 :]
        self._sketches.append(kept)
        del self._history[self._index + 1 :]
        del self._ids[self._index + 1 :]
        self._history.append(Topology(shape, bodies))
        self._ids.append(self._next_id)
        self._next_id += 1
        self._index += 1
        excess = len(self._history) - MAX_HISTORY
        if excess > 0:  # forget the oldest undo steps so long sessions don't grow without limit
            del self._history[:excess]
            del self._ids[:excess]
            del self._sketches[:excess]
            del self._datums[:excess]
            del self._mirrors[:excess]
            self._index -= excess
        return self.current

    def fold_previous_step(self) -> bool:
        """Merge the step just before the current one into it, so one undo reverts both (the previous state is forgotten).
        Used when a picked sketch region's loose face is extruded: the pick and the extrusion are one undo step."""
        if self._index < 2:
            return False
        at = self._index - 1
        for items in (self._history, self._ids, self._sketches, self._datums, self._mirrors):
            del items[at]
        self._index -= 1
        return True

    @property
    def can_undo(self) -> bool:
        return self._index > 0

    @property
    def can_redo(self) -> bool:
        return self._index < len(self._history) - 1

    def undo(self) -> bool:
        if not self.can_undo:
            return False
        self._index -= 1
        return True

    def redo(self) -> bool:
        if not self.can_redo:
            return False
        self._index += 1
        return True

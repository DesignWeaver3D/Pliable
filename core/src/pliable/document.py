"""The open model and its undo/redo history."""

import copy

from OCP.TopoDS import TopoDS_Shape

from . import bodies as body_ids
from . import recipes
from .bodies import BodyState
from .topology import Topology

MAX_HISTORY = 50  # states kept for undo; also the number of autosave snapshots


class Document:
    def __init__(self, shape: TopoDS_Shape, name: str = "Untitled", bodies: BodyState | None = None):
        self.name = name
        self._history: list[Topology] = [Topology(shape, bodies if bodies is not None else body_ids.fresh(shape))]
        self._ids: list[int] = [0]  # stable id per state, names its autosave file
        self._sketches: list[list[dict]] = [[]]  # kept sketches per state: {id, name, rev, sketch}; never mutated in place
        self._sketch_next = 1  # next sketch id; ids are never reused
        self._next_id = 1
        self._index = 0

    @classmethod
    def from_states(cls, shapes: list[TopoDS_Shape], ids: list[int], index: int, name: str, bodies: list[BodyState] | None = None, sketches: list[list[dict]] | None = None, sketch_next: int | None = None) -> "Document":
        """Rebuild a document from autosaved states (oldest first)."""
        document = cls(shapes[0], name)
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

    def _push(self, shape: TopoDS_Shape, bodies: BodyState, sketches: list[dict] | None = None) -> Topology:
        kept = self._sketches[self._index] if sketches is None else copy.deepcopy(sketches)
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
            self._index -= excess
        return self.current

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

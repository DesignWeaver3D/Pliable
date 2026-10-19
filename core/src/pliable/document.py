"""The open model and its undo/redo history."""

from OCP.TopoDS import TopoDS_Shape

from . import bodies as body_ids
from .bodies import BodyState
from .topology import Topology

MAX_HISTORY = 50  # states kept for undo; also the number of autosave snapshots


class Document:
    def __init__(self, shape: TopoDS_Shape, name: str = "Untitled", bodies: BodyState | None = None):
        self.name = name
        self._history: list[Topology] = [Topology(shape, bodies if bodies is not None else body_ids.fresh(shape))]
        self._ids: list[int] = [0]  # stable id per state, names its autosave file
        self._next_id = 1
        self._index = 0

    @classmethod
    def from_states(cls, shapes: list[TopoDS_Shape], ids: list[int], index: int, name: str, bodies: list[BodyState] | None = None) -> "Document":
        """Rebuild a document from autosaved states (oldest first)."""
        document = cls(shapes[0], name)
        if bodies is None or len(bodies) != len(shapes):
            bodies = [body_ids.fresh(s) for s in shapes]
        document._history = [Topology(s, b) for s, b in zip(shapes, bodies)]
        document._ids = list(ids)
        document._next_id = max(ids) + 1
        document._index = index
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

    def shape_of(self, state_id: int) -> TopoDS_Shape:
        return self._history[self._ids.index(state_id)].shape

    def preview(self, shape: TopoDS_Shape, kind: str = body_ids.DEFAULT_KIND, ordered: bool = False) -> Topology:
        """A topology for a result that is not committed; its bodies are matched like a commit's, nothing is recorded."""
        return Topology(shape, body_ids.carry(self.current.bodies, self.current.shape, shape, kind, ordered))

    def commit(self, shape: TopoDS_Shape, kind: str = body_ids.DEFAULT_KIND, ordered: bool = False, names: list | None = None) -> Topology:
        """Add a state for `shape`; the bodies of the current state are carried over to it (see bodies.py)."""
        return self._push(shape, body_ids.carry(self.current.bodies, self.current.shape, shape, kind, ordered, names))

    def rename_body(self, body_id: int, name: str) -> Topology:
        """Rename a body as an undoable step (the shape is unchanged)."""
        return self._push(self.current.shape, body_ids.renamed(self.current.bodies, body_id, name))

    def _push(self, shape: TopoDS_Shape, bodies: BodyState) -> Topology:
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

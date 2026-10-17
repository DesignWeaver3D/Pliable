"""The open model and its undo/redo history."""

from OCP.TopoDS import TopoDS_Shape

from .topology import Topology


class Document:
    def __init__(self, shape: TopoDS_Shape, name: str = "Untitled"):
        self.name = name
        self._history: list[Topology] = [Topology(shape)]
        self._index = 0

    @property
    def current(self) -> Topology:
        return self._history[self._index]

    def commit(self, shape: TopoDS_Shape) -> Topology:
        del self._history[self._index + 1 :]
        self._history.append(Topology(shape))
        self._index += 1
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

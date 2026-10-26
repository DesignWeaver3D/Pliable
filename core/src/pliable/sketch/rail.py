"""A kept sketch's curves as one path (a wire) for tools that follow a path: Sweep face along edge and Array along path."""

from OCP.BRepBuilderAPI import BRepBuilderAPI_MakeWire

from ..ops import OperationError
from .errors import SketchError
from .profiles import _edges


def rail_wire(content: dict):
    """The sketch's drawn curves (construction lines left out) joined into one wire; an error when there are none or they do not join."""
    try:
        edges = _edges(content)
    except (SketchError, KeyError, TypeError, ValueError) as e:
        raise OperationError(f"The sketch cannot be used as a path: {e}") from None
    if not edges:
        raise OperationError("The sketch has no curves to use as a path")
    maker = BRepBuilderAPI_MakeWire()
    for edge in edges:
        maker.Add(edge.wrapped)
    if not maker.IsDone():
        raise OperationError("The sketch's curves do not form one connected path")
    return maker.Wire()


def attach_rail(document, selection, strict: bool = True) -> None:
    """Resolve `selection.rail` (a kept sketch id) into `selection.rail_wire`; no rail leaves it None. With `strict` false a
    sketch that cannot be a path just leaves it None (for the lists of available tools and handles, which never fail)."""
    selection.rail_wire = None
    if selection.rail is None:
        return
    try:
        found = document.get_sketch(selection.rail)
        if found is None:
            raise OperationError("The sketch chosen as the path no longer exists")
        selection.rail_wire = rail_wire(found["sketch"])
    except OperationError:
        if strict:
            raise

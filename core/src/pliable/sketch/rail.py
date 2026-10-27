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


def attach_rail(document, selection, strict: bool = True, regions: bool = False) -> None:
    """Resolve `selection.rail` (a kept sketch id) into `selection.rail_wire` and `rail_content`; no rail leaves them None. With
    `strict` false a sketch that cannot be a path just leaves the wire None (for the lists of available tools and handles,
    which never fail); with `regions` (a tool that works on the sketch's regions) a sketch that is no path is not an error."""
    selection.rail_wire = selection.rail_content = None
    if selection.rail is None:
        return
    try:
        found = document.get_sketch(selection.rail)
        if found is None:
            raise OperationError("The sketch chosen as the path no longer exists")
        selection.rail_content = found["sketch"]
        selection.rail_wire = rail_wire(found["sketch"])
    except OperationError:
        if strict and not (regions and selection.rail_content is not None):
            raise

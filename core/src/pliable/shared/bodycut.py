"""Cutting a tool out of the model one body at a time.

A boolean given the whole model as one argument works through every body, however far from the tool, and its result lets
bodies that touch each other hold the same face, edge or vertex (the faces where they meet are joined). Cutting only the bodies
the tool can reach, each on its own, gives the same shapes (the tool removes the same material), leaves every other body as it
was and keeps the bodies apart, so a later merge or display can work on the changed bodies alone (mergescope.py, bodydisplay.py).
Each body gets its own copy of the tool's topology: bodies that overlap would otherwise hold the very same wall face of the cut.
"""

from OCP.BRepBndLib import BRepBndLib
from OCP.BRepBuilderAPI import BRepBuilderAPI_Copy
from OCP.Bnd import Bnd_Box
from OCP.TopAbs import TopAbs_COMPOUND, TopAbs_SHELL, TopAbs_SOLID
from OCP.TopoDS import TopoDS_Iterator, TopoDS_Shape

from ..ops import OperationError, _boolean, solids_of
from .solids import _combine, _compound


def _box(shape: TopoDS_Shape) -> Bnd_Box:
    box = Bnd_Box()
    BRepBndLib.Add_s(shape, box)
    return box


def _plain_bodies(shape: TopoDS_Shape) -> list[TopoDS_Shape] | None:
    """The bodies of `shape` (in the order `solids_of` lists them) when it is a compound, however deeply grouped, of nothing but
    solids and shells (no loose face, edge or group of solids), else None."""
    if shape.ShapeType() != TopAbs_COMPOUND:
        return None
    members = TopoDS_Iterator(shape)
    out = []
    while members.More():
        member = members.Value()
        if member.ShapeType() == TopAbs_COMPOUND:
            inner = _plain_bodies(member)
            if inner is None:
                return None
            out.extend(inner)
        elif member.ShapeType() in (TopAbs_SOLID, TopAbs_SHELL):
            out.append(member)
        else:
            return None
        members.Next()
    return out


def cut_each(solids: list[TopoDS_Shape], tool: TopoDS_Shape, skip: frozenset = frozenset(), copy_first: bool = False) -> list[list[TopoDS_Shape] | None]:
    """The solids of `solids` that `tool` cuts, one at a time: for each position the parts left of that solid (more than one when the
    cut splits it, none when nothing is left), or None for a solid the tool does not reach or that is in `skip`. `copy_first`: the first
    cut also gets a copy of the tool (when an earlier call has used it)."""
    reach = _box(tool)
    out: list[list[TopoDS_Shape] | None] = []
    used = copy_first
    for index, solid in enumerate(solids):
        if index in skip or reach.IsOut(_box(solid)):
            out.append(None)
            continue
        cut = _boolean(solid, BRepBuilderAPI_Copy(tool, False, False).Shape() if used else tool, False, glue=False)
        used = True
        if cut is None:
            raise OperationError("Boolean operation failed")
        out.append(solids_of(cut.Shape()))
    return out


def cut_reachable_bodies(shape: TopoDS_Shape, tool: TopoDS_Shape) -> TopoDS_Shape:
    """`shape` with `tool` cut out of it: each solid the tool can reach is cut on its own, the others stay as they are, and a solid
    the cut splits is listed as its parts where it was. A model that is not a compound of solids and shells is cut as a whole."""
    solids = _plain_bodies(shape)
    if solids is None or len(solids) < 2:
        return _combine(shape, tool, fuse=False)
    pieces: list[TopoDS_Shape] = []
    for solid, parts in zip(solids, cut_each(solids, tool)):
        pieces.extend([solid] if parts is None else parts)
    return _compound(pieces)

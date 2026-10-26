"""The Edit cut tool: move, resize and set the depth of a square, slot or other straight-walled through cut."""

from OCP.gp import gp_Vec

from ..holes import find_hole
from ..ops import MIN_DISTANCE, OperationError, OpResult
from ..shared.hole_edit import CLEARANCE
from ..shared.solids import finish
from ..tools import Accepts, Handle, Param, Tool, register
from ..voids import find_void, NOT_A_VOID, rebuild_void


@register
class EditVoid(Tool):
    """Move a straight-walled cut across its axis, grow or shrink it on every side, or change how deep it goes."""

    id = "edit_void"
    label = "Edit cut"
    description = (
        "Moves, resizes and sets the depth of a square, slot or other straight-walled cut that goes through the body or ends at a flat floor. "
        "Select one wall or the floor of the cut. Resize grows (or, negative, shrinks) every wall by that distance; 0 leaves a depth unchanged, and a depth as long as the body is through."
    )
    accepts = Accepts(faces=(1, 1))
    params = [Param("depth", "length", 0.0), Param("grow", "length", 0.0), Param("dx", "length"), Param("dy", "length"), Param("dz", "length")]
    move_vector = ("dx", "dy", "dz")

    def applies(self, topology, selection):
        if len(selection.faces) != 1:
            return False
        try:
            find_hole(topology, reach=False, face_id=selection.faces[0])
            return False  # a round hole has its own tool
        except OperationError:
            pass
        try:
            find_void(topology, selection.faces[0], reach=False)
        except OperationError:
            return False
        return True

    def refusal(self, topology, selection):
        return NOT_A_VOID if self.accepts.matches(selection) else None

    def void(self, topology, selection, reach: bool = True):
        if len(selection.faces) != 1:
            raise OperationError("Select one wall or the floor of the cut")
        return find_void(topology, selection.faces[0], reach=reach)

    def run(self, topology, selection, values, preview):
        info = self.void(topology, selection)
        depth, grow = values["depth"], values["grow"]
        if depth < 0:
            raise OperationError("The depth can't be negative")
        offset = gp_Vec(values["dx"], values["dy"], values["dz"])
        move = offset if offset.Magnitude() >= MIN_DISTANCE else None
        wanted = None
        if depth >= MIN_DISTANCE and (abs(depth - info.depth) > MIN_DISTANCE or (info.through and depth < info.pass_length)):
            wanted = depth
        if info.through and wanted is not None and wanted >= info.pass_length - MIN_DISTANCE:
            wanted = None  # as long as the body is what it already is
        if move is None and abs(grow) < MIN_DISTANCE and wanted is None:
            return OpResult(topology.shape, [topology.face(i) for i in info.faces])
        result = finish(rebuild_void(topology.shape, info, move, grow if abs(grow) >= MIN_DISTANCE else 0.0, wanted))
        return result

    def handles(self, topology, selection, values):
        info = self.void(topology, selection)
        shift = (values["dx"], values["dy"], values["dz"])
        axis = (info.direction.X(), info.direction.Y(), info.direction.Z())
        depth = values["depth"] if values["depth"] >= MIN_DISTANCE else (info.pass_length if info.through else info.depth)
        end = min(depth, info.pass_length)

        def at(s: float) -> tuple[float, float, float]:
            p = info.point(s)
            return (p.X() + shift[0], p.Y() + shift[1], p.Z() + shift[2])

        out = [Handle("depth", "Cut depth (end = through)", at(end), axis, min=10 * CLEARANCE, max=info.pass_length, kind="resize", shown=end, axis_from=at(0.0))]
        grow = values["grow"]
        reach = (info.out.X() * grow, info.out.Y() * grow, info.out.Z() * grow)
        grip = (info.grip.X() + shift[0] + reach[0], info.grip.Y() + shift[1] + reach[1], info.grip.Z() + shift[2] + reach[2])
        out.append(Handle("grow", "Resize cut (each wall)", grip, (info.out.X(), info.out.Y(), info.out.Z()), kind="resize", shown=grow))
        across = [i for i in range(3) if abs(axis[i]) < 0.5]
        middle = at(end / 2)
        names = ("dx", "dy", "dz")
        for i in across:
            direction = tuple(1.0 if k == i else 0.0 for k in range(3))
            out.append(Handle(names[i], f"Move along {'XYZ'[i]}", middle, direction, kind="move"))
        return out

"""The Hole features tool: the Hole Editor's one form. A new hole in a flat face or an existing hole, with any or all of a counterbore, a
countersink and a thread, made in one step. It adds no geometry of its own: it runs the helper tools in order on the intermediate models
(Add hole, counterbore or countersink for a new hole; Edit hole for an existing one; then Add counterbore or countersink to hole for the
features still to place; then Thread hole on the bore), so the preview and the single undo step are the ordinary ones."""

from OCP.gp import gp_Vec

from ..holes import find_hole, follow_cylinder, walls_on_axis
from ..ops import OperationError, OpResult, planar_normal
from ..shared.faces import _plane_axes
from ..shared.hole_edit import _target
from ..topology import Topology
from ..tools import Accepts, Param, Selection, Tool, get_tool, register

SIZES = ("Custom", "M3", "M4", "M5", "M6", "M8", "M10", "M12", "M14", "M16", "M20")  # the order of Thread hole's size list
OFF_ON = ("Off", "On")
ENDS = ("Opening", "Far end")  # a counterbore or countersink at the hole's opening, or (through hole only) at its far end
NEW_HOLE = {"bore": "add_counterbore", "sink": "add_countersink", None: "add_hole"}
CONVERT = {"bore": "convert_to_counterbore", "sink": "convert_to_countersink"}


@register
class HoleFeatures(Tool):
    """One hole with any or all of a counterbore, a countersink and a thread. Select a flat face for a new hole, or a face of a hole (or the circle at its opening) to change it."""

    id = "hole_features"
    label = "Hole features"
    description = (
        "Makes a round hole in a flat face, or changes an existing hole, with any or all of a counterbore, a countersink and a thread in one step. "
        "For a new hole, depth 0 is through; for an existing hole, 0 leaves a size unchanged. A counterbore and a countersink can't share an end: "
        "on a through hole one can be at the opening and the other at the far end."
    )
    accepts = Accepts(faces=(0, 1), edges=(0, 1), any_of=True)
    params = [
        Param("diameter", "length", 0.0),
        Param("depth", "length", 0.0),
        Param("start", "length", 0.0),
        Param("offset_u", "length"),
        Param("offset_v", "length"),
        Param("dx", "length"),
        Param("dy", "length"),
        Param("dz", "length"),
        Param("counterbore", "number", 0, options=OFF_ON),
        Param("bore_by", "number", 0, options=("Diameter", "Offset from hole")),
        Param("bore_diameter", "length", 11),
        Param("bore_offset", "length", 2.5),
        Param("bore_depth", "length", 4),
        Param("bore_end", "number", 0, options=ENDS),
        Param("countersink", "number", 0, options=OFF_ON),
        Param("sink_by", "number", 0, options=("Diameter", "Offset from hole")),
        Param("sink_diameter", "length", 12),
        Param("sink_offset", "length", 3),
        Param("sink_angle", "angle", 90),
        Param("sink_end", "number", 0, options=ENDS),
        Param("thread", "number", 0, options=OFF_ON),
        Param("thread_size", "number", 0, options=SIZES),
        Param("thread_pitch", "length", 1.25),
        Param("thread_hand", "number", 0, options=("Right", "Left")),
    ]

    @staticmethod
    def _existing(topology, selection, reach: bool):
        """The hole the one pick belongs to, or None when it is not part of a hole."""
        try:
            return find_hole(topology, reach=reach, **_target(selection))
        except OperationError:
            return None

    def applies(self, topology, selection):
        if len(selection.faces) + len(selection.edges) != 1:
            return False
        if self._existing(topology, selection, False) is not None:
            return True
        return bool(selection.faces) and not selection.edges and planar_normal(topology.face(selection.faces[0])) is not None

    def refusal(self, topology, selection):
        return "Select a flat face for a new hole, or a hole to change it" if self.accepts.matches(selection) else None

    @staticmethod
    def _features(values) -> list[tuple[str, int]]:
        """The counterbore and countersink switched on, each with its end (0 opening, 1 far end). Both at one end is refused."""
        found = [(key, int(values[end] >= 0.5)) for key, on, end in (("bore", "counterbore", "bore_end"), ("sink", "countersink", "sink_end")) if values[on] >= 0.5]
        if len(found) == 2 and found[0][1] == found[1][1]:
            raise OperationError("A counterbore and a countersink can't be at the same end of a hole; switch one off or put it at the other end")
        return found

    @staticmethod
    def _bound(tool_id: str, values: dict, end: int = 0) -> dict:
        """The helper tool's own values, taken from this form's (its `end` is the one it is placed at)."""
        tool = get_tool(tool_id)
        return tool.bind({**values, "end": end})

    @staticmethod
    def _follow(result: OpResult) -> tuple[Topology, Selection]:
        """The model after a step and a selection of the hole's bore in it, for the next step."""
        topology = Topology(result.shape)
        ids = [i for f in result.tracked_faces if (i := topology.face_id(f)) is not None]
        if not ids:
            raise OperationError("The hole could not be followed after the last step")
        return topology, Selection(faces=[ids[0]])

    def _new_hole(self, topology, selection, values, preview, features) -> OpResult:
        """The new hole, with the feature at its opening cut in the same go; its bore is tracked for the steps after."""
        if values["diameter"] < 1e-6:
            raise OperationError("The diameter must be positive")
        near = next((key for key, end in features if end == 0), None)
        tool = get_tool(NEW_HOLE[near])
        result = tool.run(topology, selection, tool.bind(values), preview)
        if not result.tracked_faces:
            centre, normal, u, v = _plane_axes(topology.face(selection.faces[0]))
            start = centre.Translated(gp_Vec(u).Multiplied(values["offset_u"])).Translated(gp_Vec(v).Multiplied(values["offset_v"]))
            result.tracked_faces = walls_on_axis(result.shape, start, normal, values["diameter"] / 2)
        return result

    def _edited(self, topology, selection, values, preview) -> OpResult:
        """Edit hole on the existing hole, with its bore tracked whatever changed (Edit hole itself loses it when the diameter changes)."""
        info = self._existing(topology, selection, True)
        result = get_tool("edit_hole").run(topology, selection, self._bound("edit_hole", values), preview)
        if not result.tracked_faces:
            move = gp_Vec(values["dx"], values["dy"], values["dz"])
            radius = values["diameter"] / 2 if values["diameter"] >= 1e-6 else info.diameter / 2
            for i in info.faces:
                result.tracked_faces += follow_cylinder(result.shape, topology.face(i), move if move.Magnitude() >= 1e-6 else None, radius, only_radius=info.diameter / 2)
        return result

    def run(self, topology, selection, values, preview):
        features = self._features(values)
        thread = values["thread"] >= 0.5
        new = self._existing(topology, selection, True) is None
        if new:
            if len(selection.faces) != 1 or selection.edges:
                raise OperationError(self.refusal(topology, selection) or "Select one flat face for a new hole")
            result = self._new_hole(topology, selection, values, preview, features)
            todo = [f for f in features if f[1] == 1]  # the opening's feature is already in the new hole
        else:
            result = self._edited(topology, selection, values, preview)
            todo = features
        ghost = result.cutters
        for key, end in todo:
            current, pick = self._follow(result)
            result = get_tool(CONVERT[key]).run(current, pick, self._bound(CONVERT[key], values, end), preview)
        if thread:
            current, pick = self._follow(result)
            step = get_tool("thread_hole").run(current, pick, self._thread_values(values), preview)
            step.tracked_faces = []
            result = step
        if preview and ghost and not result.cutters:
            result.cutters = ghost
        if preview and new:
            result.tracked_faces = []  # as Add hole: a preview keeps the flat face picked
        return result

    @staticmethod
    def _thread_values(values) -> dict:
        tool = get_tool("thread_hole")
        return tool.bind({"size": values["thread_size"], "pitch": values["thread_pitch"], "hand": values["thread_hand"]})

    def handles(self, topology, selection, values):
        features = self._features(values)
        existing = self._existing(topology, selection, True)
        if existing is None:
            near = next((key for key, end in features if end == 0), None)
            return get_tool(NEW_HOLE[near]).handles(topology, selection, get_tool(NEW_HOLE[near]).bind(values))
        out = get_tool("edit_hole").handles(topology, selection, self._bound("edit_hole", values))
        for key, end in features:
            out += get_tool(CONVERT[key]).handles(topology, selection, self._bound(CONVERT[key], values, end))
        return out

"""Tool API: how modeling tools are declared, validated and registered.

A tool is a class that declares what selection it accepts and which typed
parameters it takes, and implements `run`. The server and frontend derive
everything else (validation, applicability, the protocol description) from
those declarations. See docs/protocol.md.

Writing a tool:

    @register
    class PushPull(Tool):
        id = "push_pull"
        label = "Push/Pull"
        accepts = Accepts(faces=(1, 1))
        params = [Param("distance", "length", drag=True)]

        def applies(self, topology, selection):
            return planar_normal(topology.face(selection.faces[0])) is not None

        def run(self, topology, selection, values, preview):
            return push_pull(topology.shape, topology.face(selection.faces[0]),
                             values["distance"], preview=preview)
"""

from dataclasses import dataclass, field

from .ops import OperationError, OpResult, fillet_chamfer, planar_normal, push_pull
from .topology import Topology

PARAM_KINDS = ("length", "angle", "number")


@dataclass
class Selection:
    """Ids of selected sub-shapes in the current topology."""

    faces: list[int] = field(default_factory=list)
    edges: list[int] = field(default_factory=list)
    vertices: list[int] = field(default_factory=list)

    @classmethod
    def from_json(cls, data: dict | None) -> "Selection":
        data = data or {}
        return cls(
            faces=[int(i) for i in data.get("faces", [])],
            edges=[int(i) for i in data.get("edges", [])],
            vertices=[int(i) for i in data.get("vertices", [])],
        )

    def to_json(self) -> dict:
        return {"faces": self.faces, "edges": self.edges, "vertices": self.vertices}


@dataclass(frozen=True)
class Accepts:
    """Allowed (min, max) number of selected faces, edges and vertices. max=None means unbounded."""

    faces: tuple[int, int | None] = (0, 0)
    edges: tuple[int, int | None] = (0, 0)
    vertices: tuple[int, int | None] = (0, 0)

    def matches(self, selection: Selection) -> bool:
        return all(
            lo <= len(items) and (hi is None or len(items) <= hi)
            for (lo, hi), items in (
                (self.faces, selection.faces),
                (self.edges, selection.edges),
                (self.vertices, selection.vertices),
            )
        )

    def to_json(self) -> dict:
        return {"faces": list(self.faces), "edges": list(self.edges), "vertices": list(self.vertices)}


@dataclass(frozen=True)
class Param:
    """A typed tool parameter. `drag` marks the one the viewport drag controls."""

    name: str
    kind: str  # one of PARAM_KINDS; length is in model units, angle in degrees
    default: float = 0.0
    drag: bool = False

    def __post_init__(self):
        if self.kind not in PARAM_KINDS:
            raise ValueError(f"Unknown parameter kind {self.kind!r}")

    def to_json(self) -> dict:
        return {"name": self.name, "kind": self.kind, "default": self.default, "drag": self.drag}


class Tool:
    id: str
    label: str
    accepts: Accepts
    params: list[Param] = []

    def applies(self, topology: Topology, selection: Selection) -> bool:
        """Extra applicability check beyond the selection counts (e.g. planar faces only)."""
        return True

    def run(self, topology: Topology, selection: Selection, values: dict[str, float], preview: bool) -> OpResult:
        raise NotImplementedError

    # Provided by the framework -------------------------------------------------

    def available(self, topology: Topology, selection: Selection) -> bool:
        if any(not 0 <= i < n for ids, n in ((selection.faces, topology.face_count), (selection.edges, topology.edge_count), (selection.vertices, topology.vertex_count)) for i in ids):
            return False
        try:
            return self.accepts.matches(selection) and self.applies(topology, selection)
        except KeyError:  # a selected id that does not exist
            return False

    def bind(self, raw: dict) -> dict[str, float]:
        """Validate raw request values against the declared parameters."""
        values = {}
        for param in self.params:
            value = raw.get(param.name, param.default)
            if isinstance(value, bool) or not isinstance(value, (int, float)):
                raise OperationError(f"Parameter {param.name!r} must be a number")
            values[param.name] = float(value)
        return values

    def execute(self, topology: Topology, selection: Selection, raw_params: dict, preview: bool) -> OpResult:
        if not self.available(topology, selection):
            raise OperationError(f"{self.label} can't be used with this selection")
        return self.run(topology, selection, self.bind(raw_params), preview)

    def describe(self) -> dict:
        return {
            "id": self.id,
            "label": self.label,
            "accepts": self.accepts.to_json(),
            "params": [p.to_json() for p in self.params],
        }


TOOLS: dict[str, Tool] = {}


def register(cls: type[Tool]) -> type[Tool]:
    if cls.id in TOOLS:
        raise ValueError(f"Duplicate tool id {cls.id!r}")
    TOOLS[cls.id] = cls()
    return cls


def get_tool(tool_id: str) -> Tool:
    try:
        return TOOLS[tool_id]
    except KeyError:
        raise OperationError(f"Unknown tool {tool_id!r}") from None


@register
class PushPull(Tool):
    id = "push_pull"
    label = "Push/Pull"
    accepts = Accepts(faces=(1, 1))
    params = [Param("distance", "length", drag=True)]

    def applies(self, topology, selection):
        return planar_normal(topology.face(selection.faces[0])) is not None

    def run(self, topology, selection, values, preview):
        face = topology.face(selection.faces[0])
        return push_pull(topology.shape, face, values["distance"], preview=preview)


@register
class FilletChamfer(Tool):
    """Dragging an edge outward rounds it (fillet), inward bevels it (chamfer)."""

    id = "fillet_chamfer"
    label = "Fillet/Chamfer"
    accepts = Accepts(edges=(1, None))
    params = [Param("distance", "length", drag=True)]

    def run(self, topology, selection, values, preview):
        edges = [topology.edge(i) for i in selection.edges]
        return fillet_chamfer(topology.shape, edges, values["distance"])


from . import features  # noqa: E402,F401  (registers the feature tools)

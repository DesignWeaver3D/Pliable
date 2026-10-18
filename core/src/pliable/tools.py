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

from .ops import OperationError, OpResult, fillet_chamfer, planar_normal, push_pull, unify_result
from .topology import Topology

def _occt_reason(error: Exception) -> str:
    """A short plain-language cause for an unexpected exception from OpenCASCADE or the tool code."""
    name = type(error).__name__
    reasons = {
        "Standard_NoSuchObject": "a face or edge needed by the operation is missing",
        "Standard_ConstructionError": "the geometry is degenerate",
        "Standard_DomainError": "a value is outside what the operation allows",
        "Standard_OutOfRange": "an internal index was out of range",
        "Standard_NullObject": "part of the shape is empty",
        "StdFail_NotDone": "the operation could not be completed",
    }
    return reasons.get(name, "unexpected error: " + (str(error).strip().splitlines() or [name])[0][:80])


PARAM_KINDS = ("length", "angle", "number", "per_edge")


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
    """A typed tool parameter. `drag` marks the one the viewport drag controls.

    Kind `per_edge` is a list with one [start, end] radius pair per selected edge, in selection order; `default`
    is the start radius offered for each edge (the form builds the rows from the selection)."""

    name: str
    kind: str  # one of PARAM_KINDS; length is in model units, angle in degrees
    default: float = 0.0
    drag: bool = False

    def __post_init__(self):
        if self.kind not in PARAM_KINDS:
            raise ValueError(f"Unknown parameter kind {self.kind!r}")

    def to_json(self) -> dict:
        return {"name": self.name, "kind": self.kind, "default": self.default, "drag": self.drag}


def _bind_pairs(param: "Param", raw) -> list[list[float]]:
    """Validate a per-edge list: numbers or [start, end] pairs; an empty or missing list means "use the default"."""
    if raw is None:
        return []
    if not isinstance(raw, list) or len(raw) > 10000:
        raise OperationError(f"Parameter {param.name!r} must be a list")
    pairs = []
    for item in raw:
        pair = item if isinstance(item, list) else [item, 0]
        if len(pair) != 2 or any(isinstance(x, bool) or not isinstance(x, (int, float)) for x in pair):
            raise OperationError(f"Parameter {param.name!r} must hold numbers or [start, end] pairs")
        pairs.append([float(pair[0]), float(pair[1])])
    return pairs


class Tool:
    id: str
    label: str
    accepts: Accepts
    params: list[Param] = []
    # Relationship rules (see relations.py) whose matching faces join the selection when the user has them on.
    related: tuple[str, ...] = ()
    # Names of three length parameters that together are a point in space; the view offers to fill them by
    # clicking a reference snap (origin, axis, face centre) instead of typing.
    placement: tuple[str, str, str] | None = None

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
            if param.kind == "per_edge":
                values[param.name] = _bind_pairs(param, raw.get(param.name))
                continue
            if isinstance(value, bool) or not isinstance(value, (int, float)):
                raise OperationError(f"Parameter {param.name!r} must be a number")
            values[param.name] = float(value)
        return values

    def execute(self, topology: Topology, selection: Selection, raw_params: dict, preview: bool) -> OpResult:
        if not self.available(topology, selection):
            raise OperationError(f"{self.label} can't be used with this selection")
        values = self.bind(raw_params)
        try:
            result = self.run(topology, selection, values, preview)
            if not result.unified and result.shape is not topology.shape:
                result = unify_result(result)  # tools that skip finish() still leave no redundant faces or edges
            return result
        except OperationError:
            raise
        except Exception as e:  # OpenCASCADE raises Standard_Failure subclasses (Standard_NoSuchObject, ...)
            raise OperationError(f"{self.label} failed on this geometry ({_occt_reason(e)}); the model is unchanged") from None

    def describe(self) -> dict:
        return {
            "id": self.id,
            "label": self.label,
            "accepts": self.accepts.to_json(),
            "params": [p.to_json() for p in self.params],
            "related": list(self.related),
            "placement": list(self.placement) if self.placement else None,
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
    accepts = Accepts(faces=(1, None))
    params = [Param("distance", "length", drag=True)]
    related = ("coplanar",)

    def applies(self, topology, selection):
        normals = [planar_normal(topology.face(i)) for i in selection.faces]
        return all(n is not None for n in normals) and all(n.IsParallel(normals[0], 1e-6) and not n.IsOpposite(normals[0], 1e-6) for n in normals)

    def run(self, topology, selection, values, preview):
        faces = [topology.face(i) for i in selection.faces]
        result = push_pull(topology.shape, faces if len(faces) > 1 else faces[0], values["distance"], preview=preview)
        result.tracked_faces = result.tracked_faces[:1]  # keep a single face selected, the related ones are found again
        return result


@register
class PushPullSurface(Tool):
    """Push or pull curved faces along the surface normal: the patch of a cylinder, cone or similar surface made by
    a sketch on unrolled faces is embossed (positive) or cut (negative) at its true shape."""

    id = "push_pull_surface"
    label = "Emboss/Cut along surface"
    accepts = Accepts(faces=(1, None))
    # Not a drag tool: curved faces have no single drag direction, so the distance comes from the form.
    params = [Param("distance", "length", default=1.0)]

    def applies(self, topology, selection):
        return all(planar_normal(topology.face(i)) is None for i in selection.faces)

    def run(self, topology, selection, values, preview):
        faces = [topology.face(i) for i in selection.faces]
        result = push_pull(topology.shape, faces if len(faces) > 1 else faces[0], values["distance"], preview=preview)
        result.tracked_faces = result.tracked_faces[:1]
        return result


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

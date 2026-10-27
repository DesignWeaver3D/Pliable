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

from ..ops import OperationError, OpResult, keep_compound, unify_result
from ..topology import Topology


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
    bodies: list[int] = field(default_factory=list)  # stable body ids (see bodies.py): whole solids chosen from the body list
    axes: list[int] = field(default_factory=list)  # global axes picked in the view: 0 = X, 1 = Y, 2 = Z (lines through the origin)
    rail: int | None = None  # a kept sketch chosen as a path for Sweep face and Array along path (instead of selected edges)
    rail_wire: object = field(default=None, repr=False, compare=False)  # that sketch's curves as a wire, set by sketch/rail.py before a tool runs
    rail_content: object = field(default=None, repr=False, compare=False)  # that sketch's content (its region faces are built by tools with `rail_regions`)

    @classmethod
    def from_json(cls, data: dict | None) -> "Selection":
        data = data or {}
        return cls(
            faces=[int(i) for i in data.get("faces", [])],
            edges=[int(i) for i in data.get("edges", [])],
            vertices=[int(i) for i in data.get("vertices", [])],
            bodies=[int(i) for i in data.get("bodies", [])],
            axes=[int(i) for i in data.get("axes", []) if int(i) in (0, 1, 2)],
            rail=int(data["rail"]) if data.get("rail") is not None else None,
        )

    def to_json(self) -> dict:
        return {"faces": self.faces, "edges": self.edges, "vertices": self.vertices, "bodies": self.bodies}


@dataclass(frozen=True)
class Accepts:
    """Allowed (min, max) number of selected faces, edges and vertices. max=None means unbounded."""

    faces: tuple[int, int | None] = (0, 0)
    edges: tuple[int, int | None] = (0, 0)
    vertices: tuple[int, int | None] = (0, 0)
    bodies: tuple[int, int | None] = (0, 0)
    axes: tuple[int, int | None] = (0, 0)  # global axes (X, Y, Z) picked in the view
    any_of: bool = False  # the selection must hold something (the ranges then say how many of each kind are allowed)

    def matches(self, selection: Selection) -> bool:
        if self.any_of and not (selection.faces or selection.edges or selection.vertices or selection.bodies or selection.axes):
            return False
        return all(
            lo <= len(items) and (hi is None or len(items) <= hi)
            for (lo, hi), items in (
                (self.faces, selection.faces),
                (self.edges, selection.edges),
                (self.vertices, selection.vertices),
                (self.bodies, selection.bodies),
                (self.axes, selection.axes),
            )
        )

    def to_json(self) -> dict:
        out = {"faces": list(self.faces), "edges": list(self.edges), "vertices": list(self.vertices), "bodies": list(self.bodies)}
        if self.axes != (0, 0):
            out["axes"] = list(self.axes)
        if self.any_of:
            out["anyOf"] = True
        return out


@dataclass(frozen=True)
class Param:
    """A typed tool parameter. `drag` marks the one the viewport drag controls.

    Kind `per_edge` is a list with one [start, end] radius pair per selected edge, in selection order; `default`
    is the start radius offered for each edge (the form builds the rows from the selection)."""

    name: str
    kind: str  # one of PARAM_KINDS; length is in model units, angle in degrees
    default: float = 0.0
    drag: bool = False
    options: tuple[str, ...] = ()  # names of the allowed values (the value is the index); the form offers a list instead of a number

    def __post_init__(self):
        if self.kind not in PARAM_KINDS:
            raise ValueError(f"Unknown parameter kind {self.kind!r}")

    def to_json(self) -> dict:
        out = {"name": self.name, "kind": self.kind, "default": self.default, "drag": self.drag}
        if self.options:
            out["options"] = list(self.options)
        return out


@dataclass(frozen=True)
class Handle:
    """An on-screen manipulator for one parameter, drawn and dragged by the view.

    The handle sits at `anchor` (a model point) and slides along the straight line `direction`; dragging it by t model
    units sets the parameter to value + scale * t, so a diameter handle on a radius uses scale 2. A rotation is declared
    the same way: the anchor on the ring, `direction` the tangent there and `scale` the degrees per unit of travel, so
    the view needs no separate kind of handle. `min` bounds the parameter (None = unbounded); `unit` is the text
    shown after the value in the live label. `max` bounds it from above. A `toggle` handle is a marker for a yes/no
    parameter (0 or 1): clicking it flips the value, it is not dragged. `kind` selects the look (see the field); `links` moves other parameters along with it."""

    param: str
    label: str
    anchor: tuple[float, float, float]
    direction: tuple[float, float, float]
    scale: float = 1.0
    min: float | None = None
    unit: str = "mm"
    max: float | None = None
    toggle: bool = False
    # How the view draws it: "arrow" (a plain drag arrow), "move" (an arrow in its axis colour that moves something along
    # that axis) or "resize" (a square grip that changes a size).
    kind: str = "arrow"
    # Other parameters that change together with this one, as (parameter, change per unit of travel). A box face handle
    # that pulls the low X face sets width +1 and x -1 per unit, so the high X face stays where it is.
    links: tuple[tuple[str, float], ...] = ()
    # The value the handle shows when it is not the parameter itself (a hole's "0 = unchanged" parameters show the real
    # size), and, for an axis handle, the other end of the line the view draws from there to the anchor.
    shown: float | None = None
    axis_from: tuple[float, float, float] | None = None
    # What the view shows and accepts as a typed number: the parameter times `factor` (0.5 shows a diameter parameter as
    # a radius), led by `symbol` ("R" or the diameter sign) so the typed value's meaning is clear.
    factor: float = 1.0
    symbol: str = ""
    # A rotation handle: the axis it turns about (the view colours it by that axis) and the ring it runs on, (cx, cy, cz, radius).
    axis: tuple[float, float, float] | None = None
    ring: tuple[float, float, float, float] | None = None
    # A grid grip: the two step vectors (u, v) of the grid it sits on. The view drags it in their plane; whole steps along u
    # change `param` and whole steps along v change the first linked parameter, independently.
    plane: tuple[tuple[float, float, float], tuple[float, float, float]] | None = None
    # The x and y axes of the sketch plane on the face the handle belongs to (push/pull's direction gizmo swings about them).
    frame: tuple[tuple[float, float, float], tuple[float, float, float]] | None = None
    # A rotation handle: the parameter values (degrees) the drag snaps to when it passes close to one.
    snaps: tuple[float, ...] = ()
    # A rotation handle drawn as a short arc beside the thing it turns (like the push/pull direction arcs) rather than a whole ring.
    arc: bool = False
    # A move arrow whose label shows the distance moved along it in the drag, not the parameter (its parameter and links are world components of that line).
    along: bool = False
    # What each snap angle is ("face", "global axes"), in the order of `snaps`, for the label; and, for a handle that another handle turns, that handle's parameter (the view swings it as the other is dragged).
    snap_names: tuple[str, ...] = ()
    turned_by: str = ""
    # A rotation handle drawn as a pie slice about its axis: an arc from the source's angle (0) to the parameter's angle on `ring`, with a short line
    # toward the axis at each end, the degrees on the arc, and the grip following the arc (the circular array's angle).
    pie: bool = False
    # A number shown over `anchor` that the mouse wheel and typing change (the circular array's count over its source); it has no grip.
    badge: bool = False
    # A dimension-style length grip (`axis_from` to `anchor`): an extension line at each end of its line, running along this vector (the helical sweep's pitch: from the dimension line in toward the measured profile).
    extension: tuple[float, float, float] | None = None
    # The grip is drawn as an arrowhead at the end of its line (pointing along `direction`), and its value is shown in the middle of the line, like a length dimension.
    arrowhead: bool = False

    def to_json(self, value: float, values: dict | None = None) -> dict:
        length = sum(c * c for c in self.direction) ** 0.5 or 1.0
        if self.shown is not None:
            value = self.shown
        return {
            "axis": [float(c) for c in self.axis] if self.axis else None,
            "ring": [float(c) for c in self.ring] if self.ring else None,
            "plane": [[float(c) for c in self.plane[0]], [float(c) for c in self.plane[1]]] if self.plane else None,
            "frame": [[float(c) for c in self.frame[0]], [float(c) for c in self.frame[1]]] if self.frame else None,
            "snaps": list(self.snaps),
            "arc": self.arc,
            "along": self.along,
            "snapNames": list(self.snap_names),
            "turnedBy": self.turned_by,
            "pie": self.pie,
            "badge": self.badge,
            "axisFrom": [float(c) for c in self.axis_from] if self.axis_from else None,
            "extension": [float(c) for c in self.extension] if self.extension else None,
            "arrowhead": self.arrowhead,
            "param": self.param,
            "label": self.label,
            "anchor": [float(c) for c in self.anchor],
            "direction": [c / length for c in self.direction],
            "scale": self.scale,
            "min": self.min,
            "max": self.max,
            "toggle": self.toggle,
            "kind": "toggle" if self.toggle else self.kind,
            "unit": self.unit,
            "factor": self.factor,
            "symbol": self.symbol,
            "value": value,
            "links": [{"param": name, "scale": scale, "value": (values or {}).get(name, 0.0)} for name, scale in self.links if values is None or name in values],
        }


def round_handles(param: str, name: str, centre, radial, across, diameter: float, offset: float = 0.0, **kw) -> list[Handle]:
    """The handles of a diameter-valued `param`: one radius handle from `centre` outward along `radial`, and a
    double-ended diameter handle across the feature along `across` (perpendicular to `radial`). Both set the same
    parameter, so dragging either (or typing R or a diameter) changes the one value. `offset` pushes the grips out
    along their direction, and `kw` (min, max, shown, kind...) goes to every handle."""
    reach = diameter / 2 + offset
    kw.setdefault("kind", "resize")
    point = lambda d: tuple(c + d[k] * reach for k, c in enumerate(centre))
    flip = tuple(-c for c in across)
    return [
        Handle(param, f"{name} radius", point(radial), tuple(radial), scale=2.0, factor=0.5, symbol="R", **kw),
        Handle(param, f"{name} diameter (+)", point(across), tuple(across), scale=2.0, symbol="Ø", **kw),
        Handle(param, f"{name} diameter (-)", point(flip), flip, scale=2.0, symbol="Ø", **kw),
    ]


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
    # One or two plain sentences for the tooltip: what the tool does and what to select (required, see tests/test_tool_descriptions.py).
    description: str = ""
    accepts: Accepts
    params: list[Param] = []
    # What the tool accepts when a kept sketch is chosen as its path (`Selection.rail`) instead of edges; None = no sketch path.
    rail_accepts: "Accepts | None" = None
    rail_regions = False  # a chosen kept sketch stands in for the faces: its closed regions are the faces the tool works on
    # Relationship rules (see relations.py) whose matching faces join the selection when the user has them on.
    related: tuple[str, ...] = ()
    # Names of three length parameters that together are a point in space; the view offers to fill them by
    # clicking a reference snap (origin, axis, face centre) instead of typing.
    placement: tuple[str, str, str] | None = None
    # Names of three length parameters that are a displacement (move, copy step); the view offers to pick a base point
    # and a destination point and fills them with destination minus base.
    move_vector: tuple[str, str, str] | None = None
    pick_axis: tuple[str, str, str, str] | None = None  # parameters a form's Pick axis button fills: x, y, z of the picked point and the choice list set to "picked point"
    pick_edge: tuple[str, str] | None = None  # parameters a form's Pick axis edge button fills: the picked edge's id and the choice list set to "picked edge" (index 3)
    pick_plane: tuple[str, ...] | None = None  # parameters a form's Pick plane and datum plane buttons fill: point x, y, z, normal x, y, z and the choice list (set to index 4, "picked plane")
    # Where the tool starts: "selection" (the user selects something, then the tool acts on it) or "tool" (the tool is
    # chosen first and places something new, like a primitive); the view shows `handles` accordingly.
    starts_from: str = "selection"
    hidden: bool = False  # kept so old requests work, but not offered in the strip or the tool list
    whole_model_needs_one_body: bool = False  # with nothing selected the tool acts on every body; offer it only when there is one
    # Name for bodies this tool creates ("Box" gives "Box 1", "Box 2"), and whether it keeps the solids in their order
    # (whole-body transforms), which lets the bodies be matched by position (see bodies.py).
    body_kind: str = "Body"
    keeps_body_order: bool = False

    def handles(self, topology: Topology, selection: Selection, values: dict[str, float]) -> list[Handle]:
        """On-screen manipulators for the current parameter values: one per parameter that can be dragged in the view.
        Typed entry stays available for every parameter. The default is none."""
        return []

    def anchors(self, values: dict[str, float]) -> list[tuple[str, tuple[float, float, float]]]:
        """For a tool with `placement`: the points of the new shape that can be put at the destination, as (label,
        offset from the placement point). The first is the default and has offset zero, so the stored parameters stay
        the placement point and the sizes. Default: none."""
        return []

    def combines(self, topology: Topology, selection: Selection, values: dict) -> "list[int] | str | None":
        """Indices of the bodies this run combines with another solid (their primitive recipes end), "all" for every
        body, or None. The default is none; other shape changes are noticed by the recipe's signature (recipes.py)."""
        return None

    def applies(self, topology: Topology, selection: Selection) -> bool:
        """Extra applicability check beyond the selection counts (e.g. planar faces only)."""
        return True

    def refusal(self, topology: Topology, selection: Selection) -> str | None:
        """A plain reason this selection is refused, when the generic "can't be used" would not say enough (None = generic)."""
        return None

    def run(self, topology: Topology, selection: Selection, values: dict[str, float], preview: bool) -> OpResult:
        raise NotImplementedError

    # Provided by the framework -------------------------------------------------

    def available(self, topology: Topology, selection: Selection) -> bool:
        if any(not 0 <= i < n for ids, n in ((selection.faces, topology.face_count), (selection.edges, topology.edge_count), (selection.vertices, topology.vertex_count)) for i in ids):
            return False
        known = {b.id for b in topology.bodies.bodies}
        if any(i not in known for i in selection.bodies):
            return False
        try:
            on_rail = selection.rail_wire is not None and not selection.edges
            if self.rail_regions:  # a whole chosen sketch stands in for the faces (and may come with an edge or axis)
                on_rail = selection.rail_content is not None and not selection.faces
            accepts = self.rail_accepts if self.rail_accepts and on_rail else self.accepts
            return accepts.matches(selection) and self.applies(topology, selection)
        except KeyError:  # a selected id that does not exist
            return False

    def offered(self, topology: Topology, selection: Selection) -> bool:
        """Whether the tool strip should offer the tool: `available`, and not a whole-model tool picking several bodies at once."""
        if self.whole_model_needs_one_body and not (selection.faces or selection.edges or selection.vertices or selection.bodies) and len(topology.bodies.bodies) > 1:
            return False  # nothing selected means "the whole model", which is only unambiguous with a single body
        return self.available(topology, selection)

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
            raise OperationError(self.refusal(topology, selection) or f"{self.label} can't be used with this selection")
        values = self.bind(raw_params)
        try:
            result = self.run(topology, selection, values, preview)
            if not result.unified and result.shape is not topology.shape:
                result = unify_result(result)  # tools that skip finish() still leave no redundant faces or edges
            result.shape = keep_compound(topology.shape, result.shape)
            return result
        except OperationError:
            raise
        except Exception as e:  # OpenCASCADE raises Standard_Failure subclasses (Standard_NoSuchObject, ...)
            raise OperationError(f"{self.label} failed on this geometry ({_occt_reason(e)}); the model is unchanged") from None

    def handle_list(self, topology: Topology, selection: Selection, raw_params: dict) -> list[dict]:
        """`handles` for raw request values, as JSON with each parameter's current value; empty when the tool has
        none or the selection is unusable (handles are a convenience, they never fail a request)."""
        if type(self).handles is Tool.handles or not self.available(topology, selection):
            return []
        try:
            values = self.bind(raw_params)
            names = {p.name for p in self.params}
            return [h.to_json(values[h.param], values) for h in self.handles(topology, selection, values) if h.param in names and not isinstance(values[h.param], list)]
        except Exception:
            return []

    def anchor_list(self, raw_params: dict) -> list[dict]:
        """`anchors` for raw request values as JSON; empty on any problem (a convenience, never fails a request)."""
        if type(self).anchors is Tool.anchors:
            return []
        try:
            return [{"label": label, "offset": [float(c) for c in offset]} for label, offset in self.anchors(self.bind(raw_params))]
        except Exception:
            return []

    def describe(self) -> dict:
        return {
            "id": self.id,
            "label": self.label,
            "description": self.description,
            "accepts": self.accepts.to_json(),
            "params": [p.to_json() for p in self.params],
            "related": list(self.related),
            "placement": list(self.placement) if self.placement else None,
            "moveVector": list(self.move_vector) if self.move_vector else None,
            "pickAxis": list(self.pick_axis) if self.pick_axis else None,
            "pickEdge": list(self.pick_edge) if self.pick_edge else None,
            "pickPlane": list(self.pick_plane) if self.pick_plane else None,
            "startsFrom": self.starts_from,
            "hidden": self.hidden,
            "hasHandles": type(self).handles is not Tool.handles,
            **({"railAccepts": self.rail_accepts.to_json()} if self.rail_accepts else {}),
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

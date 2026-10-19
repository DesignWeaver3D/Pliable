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

from .ops import MIN_DISTANCE, OperationError, OpResult, edge_curve, edge_outward_normal, face_handle_point, fillet_chamfer, planar_normal, push_pull, unify_result
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
    bodies: list[int] = field(default_factory=list)  # stable body ids (see bodies.py): whole solids chosen from the body list

    @classmethod
    def from_json(cls, data: dict | None) -> "Selection":
        data = data or {}
        return cls(
            faces=[int(i) for i in data.get("faces", [])],
            edges=[int(i) for i in data.get("edges", [])],
            vertices=[int(i) for i in data.get("vertices", [])],
            bodies=[int(i) for i in data.get("bodies", [])],
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

    def matches(self, selection: Selection) -> bool:
        return all(
            lo <= len(items) and (hi is None or len(items) <= hi)
            for (lo, hi), items in (
                (self.faces, selection.faces),
                (self.edges, selection.edges),
                (self.vertices, selection.vertices),
                (self.bodies, selection.bodies),
            )
        )

    def to_json(self) -> dict:
        return {"faces": list(self.faces), "edges": list(self.edges), "vertices": list(self.vertices), "bodies": list(self.bodies)}


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

    def to_json(self, value: float, values: dict | None = None) -> dict:
        length = sum(c * c for c in self.direction) ** 0.5 or 1.0
        if self.shown is not None:
            value = self.shown
        return {
            "axisFrom": [float(c) for c in self.axis_from] if self.axis_from else None,
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
            "value": value,
            "links": [{"param": name, "scale": scale, "value": (values or {}).get(name, 0.0)} for name, scale in self.links if values is None or name in values],
        }


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
    # Relationship rules (see relations.py) whose matching faces join the selection when the user has them on.
    related: tuple[str, ...] = ()
    # Names of three length parameters that together are a point in space; the view offers to fill them by
    # clicking a reference snap (origin, axis, face centre) instead of typing.
    placement: tuple[str, str, str] | None = None
    # Names of three length parameters that are a displacement (move, copy step); the view offers to pick a base point
    # and a destination point and fills them with destination minus base.
    move_vector: tuple[str, str, str] | None = None
    # Where the tool starts: "selection" (the user selects something, then the tool acts on it) or "tool" (the tool is
    # chosen first and places something new, like a primitive); the view shows `handles` accordingly.
    starts_from: str = "selection"
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
            raise OperationError(self.refusal(topology, selection) or f"{self.label} can't be used with this selection")
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
            "startsFrom": self.starts_from,
            "hasHandles": type(self).handles is not Tool.handles,
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
    description = "Moves flat faces in or out along their normal, adding or removing material. Select one or more flat faces, then drag or type a distance. Alt+click cycles through faces under the cursor."
    accepts = Accepts(faces=(1, None))
    params = [Param("distance", "length", drag=True)]
    related = ("coplanar", "parallel")

    def handles(self, topology, selection, values):
        if _all_round_walls(topology, selection):
            return []  # a hole wall is dragged along its radius in the view
        face = topology.face(selection.faces[0])
        normal = planar_normal(face)
        if normal is None:
            return []
        point = face_handle_point(face)
        distance = values["distance"]
        return [Handle("distance", "Push/pull", (point.X() + normal.X() * distance, point.Y() + normal.Y() * distance, point.Z() + normal.Z() * distance), (normal.X(), normal.Y(), normal.Z()))]

    def applies(self, topology, selection):
        if _all_round_walls(topology, selection):
            return True
        normals = [planar_normal(topology.face(i)) for i in selection.faces]
        return all(n is not None for n in normals) and all(n.IsParallel(normals[0], 1e-6) and not n.IsOpposite(normals[0], 1e-6) for n in normals)

    def run(self, topology, selection, values, preview):
        if _all_round_walls(topology, selection):
            return _push_round_walls(topology, selection, values["distance"])
        faces = [topology.face(i) for i in selection.faces]
        result = push_pull(topology.shape, faces if len(faces) > 1 else faces[0], values["distance"], preview=preview)
        result.tracked_faces = result.tracked_faces[:1]  # keep a single face selected, the related ones are found again
        return result


def _all_round_walls(topology, selection) -> bool:
    """True when every selected face is a whole cylinder wall (a hole or a boss)."""
    from OCP.BRepAdaptor import BRepAdaptor_Surface
    from OCP.BRepTools import BRepTools
    from OCP.GeomAbs import GeomAbs_Cylinder
    import math

    for i in selection.faces:
        face = topology.face(i)
        if BRepAdaptor_Surface(face).GetType() != GeomAbs_Cylinder:
            return False
        u0, u1, _, _ = BRepTools.UVBounds_s(face)
        if u1 - u0 < 2 * math.pi - 1e-6:
            return False
    return True


def _push_round_walls(topology, selection, distance: float) -> OpResult:
    """Push/pull on a hole or boss wall moves the wall along its normal: a hole shrinks when the wall is pushed
    toward the axis (material added) and a boss grows when pulled outward, so the radius changes by `distance`."""
    from .features import Hole, apply_holes, finish

    holes = [Hole(topology.face(i)) for i in selection.faces]
    moves = []
    for hole in holes:
        radius = hole.radius + distance if hole.boss else hole.radius - distance
        if radius < MIN_DISTANCE:
            raise OperationError("That would close the hole completely; use a smaller distance")
        moves.append((radius, None))
    return finish(apply_holes(topology.shape, holes, moves))


@register
class PushPullSurface(Tool):
    """Push or pull curved faces along the surface normal: the patch of a cylinder, cone or similar surface made by
    a sketch on unrolled faces is embossed (positive) or cut (negative) at its true shape."""

    id = "push_pull_surface"
    label = "Emboss/Cut along surface"
    description = "Raises or cuts curved faces along their surface normal, for example a pattern drawn on unrolled faces. Select curved faces and type a distance; positive raises, negative cuts."
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
    description = "Rounds or bevels the selected edges. Select edges, then drag outward to round (fillet) or inward to bevel (chamfer), or type a distance."
    accepts = Accepts(edges=(1, None))
    params = [Param("distance", "length", drag=True)]

    def handles(self, topology, selection, values):
        edge = topology.edge(min(selection.edges))
        normal = edge_outward_normal(topology, edge)
        if normal is None:
            return []
        at, _, _ = edge_curve(edge)
        mid = at(0.5)
        d = values["distance"]
        return [Handle("distance", "Round (outward) or bevel (inward)", tuple(m + n * d for m, n in zip(mid, normal)), tuple(normal))]

    def run(self, topology, selection, values, preview):
        edges = [topology.edge(i) for i in sorted(selection.edges)]  # id order avoids stray zero-length edges at corners
        return fillet_chamfer(topology.shape, edges, values["distance"])


from . import features  # noqa: E402,F401  (registers the feature tools)
from . import stretch  # noqa: E402,F401  (registers the stretch tool)

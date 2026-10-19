"""Stable body identity: every solid of the model has an id and a name that survive operations.

A body is one solid of the document's shape. Each document state carries a `BodyState` listing one `Body` per solid,
in the order `solids_of` finds them. After an operation `carry` matches the new solids to the old bodies so a body
keeps its id and name through fillets, push/pull, moves and so on:

1. a solid that is the same shape, or has the same box and volume, is the same body;
2. otherwise, in creation order, each old body takes the new solid it overlaps most (by bounding-box overlap), so a
   body split in two keeps its id on the part that overlaps most (the larger one), and a union keeps the id of the
   first body and consumes the second;
3. what is left is matched by equal volume (a body that was only moved), then a lone old and a lone new body pair up;
4. any new solid still unmatched is a new body with the next id and an auto name ("Box 1").

Whole-body tools that keep the solids in order (`ordered=True`) match by position when the count is unchanged.
"""

from dataclasses import dataclass, field
from typing import Callable

from OCP.BRepBndLib import BRepBndLib
from OCP.BRepGProp import BRepGProp
from OCP.Bnd import Bnd_Box
from OCP.GProp import GProp_GProps
from OCP.TopoDS import TopoDS_Shape

from .ops import solids_of

DEFAULT_KIND = "Body"


@dataclass(frozen=True)
class Body:
    id: int
    name: str


@dataclass(frozen=True)
class BodyState:
    """The bodies of one document state, parallel to the solids of its shape, plus the counters for new ones."""

    bodies: tuple[Body, ...] = ()
    next_id: int = 1
    counts: dict = field(default_factory=dict)  # auto-name counter per kind

    def find(self, body_id: int) -> int | None:
        return next((i for i, b in enumerate(self.bodies) if b.id == body_id), None)

    def to_json(self) -> dict:
        return {"bodies": [[b.id, b.name] for b in self.bodies], "next": self.next_id, "counts": dict(self.counts)}

    @classmethod
    def from_json(cls, data: dict) -> "BodyState":
        return cls(tuple(Body(int(i), str(n)) for i, n in data["bodies"]), int(data["next"]), dict(data["counts"]))


def box_of(shape: TopoDS_Shape) -> list[float]:
    box = Bnd_Box()
    BRepBndLib.Add_s(shape, box)
    if box.IsVoid():
        return [0.0] * 6
    lo, hi = box.CornerMin(), box.CornerMax()
    return [lo.X(), lo.Y(), lo.Z(), hi.X(), hi.Y(), hi.Z()]


def _volume(shape: TopoDS_Shape) -> float:
    props = GProp_GProps()
    BRepGProp.VolumeProperties_s(shape, props)
    return abs(props.Mass())


PAD = 1e-6  # flat boxes are padded a little so a plate still overlaps itself


def _overlap(a: list[float], b: list[float]) -> float:
    """Intersection over union of two bounding boxes (0 when they do not touch)."""
    inter = pa = pb = 1.0
    for k in range(3):
        lo, hi = max(a[k], b[k]), min(a[k + 3], b[k + 3])
        if hi < lo - PAD:
            return 0.0
        inter *= max(hi - lo, 0.0) + PAD
        pa *= a[k + 3] - a[k] + PAD
        pb *= b[k + 3] - b[k] + PAD
    union = pa + pb - inter
    return inter / union if union > 0 else 0.0


def _close(a: list[float], b: list[float], tol: float) -> bool:
    return all(abs(x - y) <= tol for x, y in zip(a, b))


def _add(state: BodyState, name: str | None, kind: str) -> BodyState:
    """The state with one more body, appended (named automatically from `kind` when `name` is empty)."""
    counts = dict(state.counts)
    if not name:
        counts[kind] = counts.get(kind, 0) + 1
        name = f"{kind} {counts[kind]}"
    return BodyState(state.bodies + (Body(state.next_id, name),), state.next_id + 1, counts)


def fresh(shape: TopoDS_Shape, names: Callable | None = None, kind: str = DEFAULT_KIND) -> BodyState:
    """Bodies for a shape with no history (a new or imported document); `names` maps a solid to its part name or None."""
    state = BodyState()
    for solid in solids_of(shape):
        state = _add(state, names(solid) if names else None, kind)
    return state


def carry(prev: BodyState, old_shape: TopoDS_Shape, new_shape: TopoDS_Shape, kind: str = DEFAULT_KIND,
          ordered: bool = False, names: Callable | None = None) -> BodyState:
    """The bodies of `new_shape`, given the bodies of `old_shape` before the operation (see the module notes)."""
    olds, news = solids_of(old_shape), solids_of(new_shape)
    if len(olds) != len(prev.bodies):  # state out of step with its shape: start over rather than guess
        return fresh(new_shape, names, kind)
    old_boxes = [box_of(s) for s in olds]
    new_boxes = [box_of(s) for s in news]
    diag = max([max(b[3] - b[0], b[4] - b[1], b[5] - b[2]) for b in old_boxes + new_boxes] or [1.0])
    tol = max(diag * 1e-7, 1e-9)
    volumes: dict = {}

    def vol(side, index):
        key = (side, index)
        if key not in volumes:
            volumes[key] = _volume((olds if side == 0 else news)[index])
        return volumes[key]

    match: dict[int, int] = {}  # new index -> old index
    used: set[int] = set()

    def take(j, i):
        match[j] = i
        used.add(i)

    if ordered and len(olds) == len(news):
        for j in range(len(news)):
            take(j, j)
    else:
        for i, old in enumerate(olds):  # 1: unchanged solids
            for j, new in enumerate(news):
                if j not in match and (old.IsSame(new) or (_close(old_boxes[i], new_boxes[j], tol) and abs(vol(0, i) - vol(1, j)) <= 1e-9 * max(vol(0, i), 1.0) + tol)):
                    take(j, i)
                    break
        for i in range(len(olds)):  # 2: most overlap, in creation order
            if i in used:
                continue
            best, best_score = None, 0.0
            for j in range(len(news)):
                if j in match:
                    continue
                score = _overlap(old_boxes[i], new_boxes[j])
                if score > best_score + 1e-12 or (best is not None and abs(score - best_score) <= 1e-12 and vol(1, j) > vol(1, best)):
                    best, best_score = j, score
            if best is not None and best_score > 0.0:
                take(best, i)
        for i in range(len(olds)):  # 3: same volume, so only moved
            if i in used:
                continue
            for j in range(len(news)):
                if j not in match and abs(vol(0, i) - vol(1, j)) <= 1e-6 * max(vol(0, i), 1.0):
                    take(j, i)
                    break
        left_old = [i for i in range(len(olds)) if i not in used]
        left_new = [j for j in range(len(news)) if j not in match]
        if len(left_old) == 1 and len(left_new) == 1:
            take(left_new[0], left_old[0])

    state = BodyState((), prev.next_id, prev.counts)
    for j in range(len(news)):
        if j in match:
            state = BodyState(state.bodies + (prev.bodies[match[j]],), state.next_id, state.counts)
        else:
            state = _add(state, names(news[j]) if names else None, kind)
    return state


def renamed(state: BodyState, body_id: int, name: str) -> BodyState:
    index = state.find(body_id)
    if index is None:
        raise KeyError(body_id)
    bodies = list(state.bodies)
    bodies[index] = Body(body_id, name)
    return BodyState(tuple(bodies), state.next_id, state.counts)


def namer(named: list[tuple[TopoDS_Shape, str]], by_size: bool = False) -> Callable:
    """A `names` function for fresh/carry from (solid, part name) pairs. A solid is found by identity; with `by_size`
    (parts that were copied or moved on the way in) by bounding-box size and volume instead."""
    def size_of(solid):
        b = box_of(solid)
        return [b[3] - b[0], b[4] - b[1], b[5] - b[2]]

    sizes = [(size_of(solid), _volume(solid)) for solid, _ in named] if by_size else []

    def name_of(solid: TopoDS_Shape) -> str | None:
        for solid_, name in named:
            if solid_.IsPartner(solid):
                return name
        if by_size:
            box = box_of(solid)
            size, volume = [box[3] - box[0], box[4] - box[1], box[5] - box[2]], _volume(solid)
            for (known, known_volume), (_, name) in zip(sizes, named):
                if abs(known_volume - volume) <= 1e-6 * max(volume, 1.0) and all(abs(a - b) <= 1e-6 * max(a, 1.0) for a, b in zip(sorted(known), sorted(size))):
                    return name
        return None

    return name_of

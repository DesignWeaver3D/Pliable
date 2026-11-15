"""One stretch from start to finish: zones, band, field, new geometry, the rebuilt solid and its checks."""

from dataclasses import dataclass

import numpy as np

from ..ops import OperationError
from ..validity import is_valid
from .band import Band, layout
from .body import Body
from .continuity import creases, folds
from .deform import Deformer
from .falloff import Falloff, LINEAR
from .field import Field, Move
from .rebuild import rebuild
from .refillet import remake_fillets
from .shorten import overrun_features, remove_features
from .zones import Zones

FINE, QUICK = 1e-8, 1e-6  # how closely fitted geometry follows the true shape, as a share of the body's size (commit, live preview)
LOOSEST = 1e-4  # the largest gap between an edge and its faces that is accepted, as a share of the body's size
FOLDS = "The move folds the stretched faces through themselves; use a smaller move or a longer band."


@dataclass
class Stretched:
    solid: object
    faces: list  # the selected faces, edges and vertices in the new solid
    edges: list
    vertices: list
    freeform: int = 0  # faces that became free-form
    removed: int = 0  # features removed by a shortening


@dataclass
class Plan:
    """What a stretch of this selection would deform: for the band gizmo and the run itself."""

    body: Body
    zones: Zones
    band: Band
    start: float
    riders: list

    @property
    def centre(self) -> np.ndarray:
        """The middle of the protected part (the box around its corners)."""
        points = np.array([self.body.point(v) for v in self.zones.protected_vertices])
        return (points.min(axis=0) + points.max(axis=0)) / 2


def plan(solid, faces: list, edges: list, vertices: list, length: float) -> Plan:
    body = Body(solid)
    numbers = [{n for n in (find(s) for s in shapes) if n is not None} for find, shapes in ((body.face_number, faces), (body.edge_number, edges), (body.vertex_number, vertices))]
    zones, band = layout(body, *numbers)
    start, riders = band.start(length)
    return Plan(body, zones, band, start, riders)


def _field(made: Plan, move: Move, order: int) -> Field:
    plateaus = [(r.low, r.high) for r in made.riders]
    straight = Field(made.band.direction, Falloff(made.start, made.band.end, plateaus, LINEAR), move, True)
    # A straight ramp re-fits flat faces as flat faces; it is kept unless it would leave a crease, or a feature riding in a tilted band would lose its shape.
    if not (move.turns and made.riders) and not creases(made.body, made.zones, straight):
        return straight
    return Field(made.band.direction, Falloff(made.start, made.band.end, plateaus, order), move, False)


def stretch(solid, faces: list, edges: list, vertices: list, make_move, length: float, order: int, fine: bool, first: Plan | None = None) -> Stretched:
    """The solid with the selected faces, edges and vertices moved rigidly by `make_move(plan)` and the faces joining
    them to the rest deformed over the band (`length` 0 = Auto). A shortening that does not fit in the band removes
    the features in its way first."""
    removed = 0
    while True:
        made = first if first is not None and removed == 0 else plan(solid, faces, edges, vertices, length)
        body, move = made.body, make_move(made)
        field = _field(made, move, order)
        if folds(body, made.zones, field):
            features = overrun_features(made.band, made.start, made.riders) if float(move.shift @ made.band.direction) < 0 else []
            if not features:
                raise OperationError(FOLDS)
            solid, (faces, edges, vertices) = remove_features(body, features, [faces, edges, vertices])
            removed += len(features)
            continue
        outcome = Deformer(body, made.zones, made.riders, field, (FINE if fine else QUICK) * body.size).run()
        new, new_faces, new_edges, new_vertices = rebuild(body, outcome.geometry, LOOSEST * body.size)
        from ..shared.solids import _volume

        if not is_valid(new) or _volume(new) <= 0:
            raise OperationError(FOLDS)
        pick = lambda shapes, find, made_shapes: [made_shapes[n] for n in (find(s) for s in shapes) if n is not None]
        kept = [pick(faces, body.face_number, new_faces), pick(edges, body.edge_number, new_edges), pick(vertices, body.vertex_number, new_vertices)]
        new, kept, remade = remake_fillets(body, new, new_faces, kept)
        return Stretched(new, *kept, max(0, outcome.freeform - remade), removed)

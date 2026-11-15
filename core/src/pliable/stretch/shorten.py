"""Removing a feature a shortening runs over, so the band can reach past it."""

from OCP.BRepAlgoAPI import BRepAlgoAPI_Defeaturing

from ..ops import _follow, OperationError, solids_of
from .band import Band, LEVEL_TOL
from ..validity import is_valid
from .body import Body
from .rebuild import rebuild, unchanged


def overrun_features(band: Band, start: float, riders: list) -> list:
    """The features to remove when the move does not fit in the band: those riding inside it nearest the moved end,
    else those the band stops at; with them every feature at the same levels (a row of holes goes together). Empty
    when the band stops at something that cannot be removed."""
    if riders:
        first = max(riders, key=lambda f: f.high)
    else:
        first = next((f for f in band.features if abs(f.high - start) < LEVEL_TOL), None)
    if first is None:
        return []
    return [f for f in band.features if f.low < first.high - LEVEL_TOL and f.high > first.low + LEVEL_TOL]


def _lift_out(body: Body, features: list, kept: list):
    """The solid rebuilt without the features' faces and the holes they bound in the faces around them; None when that
    does not leave a sound solid."""
    drop = frozenset(f for feature in features for f in feature.faces)
    solid, faces, edges, vertices = rebuild(body, unchanged(body), 0.0, drop)
    if not is_valid(solid):
        return None
    follow = lambda shapes, find, made: [made[n] for n in (find(s) for s in shapes) if n is not None and made[n] is not None]
    return solid, [follow(kept[0], body.face_number, faces), follow(kept[1], body.edge_number, edges), follow(kept[2], body.vertex_number, vertices)]


def remove_features(body: Body, features: list, kept: list):
    """The solid without the features' faces (the faces around them close over the gaps), and the `kept` lists of
    shapes (faces, edges, vertices) followed into it. An island is lifted out directly; the kernel's feature removal
    is the fallback."""
    lifted = _lift_out(body, features, kept)
    if lifted is not None:
        return lifted
    operation = BRepAlgoAPI_Defeaturing()
    operation.SetShape(body.solid)
    for feature in features:
        for face in feature.faces:
            operation.AddFaceToRemove(body.faces[face])
    operation.SetRunParallel(True)
    try:
        operation.Build()
    except Exception:
        operation = None
    if operation is None or not operation.IsDone() or operation.Shape().IsNull() or len(solids_of(operation.Shape())) != 1:
        raise OperationError("Stretch could not remove the feature the moved end runs over; shorten by less, or remove the feature first")
    return solids_of(operation.Shape())[0], [_follow(operation, shapes) for shapes in kept]

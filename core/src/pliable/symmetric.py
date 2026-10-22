"""Symmetric push/pull: which faces move together, and the plane they are symmetric about.

A face of a solid has a counterpart on the other side of a mirror plane when the model is symmetric there: a face
with the opposite outward normal, the same area, centred where the first face's mirror image is. The mirror
plane is the nearest origin plane or datum plane parallel to the face (see `mirror_candidates`)."""

import math

from OCP.BRepGProp import BRepGProp
from OCP.GProp import GProp_GProps

from .ops import OperationError, planar_normal

TOLERANCE = 1e-3
ORIGIN_PLANES = (
    {"name": "XY origin plane", "origin": (0.0, 0.0, 0.0), "normal": (0.0, 0.0, 1.0)},
    {"name": "XZ origin plane", "origin": (0.0, 0.0, 0.0), "normal": (0.0, 1.0, 0.0)},
    {"name": "YZ origin plane", "origin": (0.0, 0.0, 0.0), "normal": (1.0, 0.0, 0.0)},
)


def _dot(a, b) -> float:
    return sum(x * y for x, y in zip(a, b))


def centre_and_area(face) -> tuple[tuple[float, float, float], float]:
    props = GProp_GProps()
    BRepGProp.SurfaceProperties_s(face, props)
    c = props.CentreOfMass()
    return (c.X(), c.Y(), c.Z()), props.Mass()


def mirror_candidates(face, datums) -> list[dict]:
    """The planes parallel to a planar face that it does not lie in, nearest first: the origin planes and the datum
    planes (each `{name, origin, normal, distance}`, `distance` being the face's signed distance from the plane)."""
    normal = planar_normal(face)
    if normal is None:
        return []
    n = (normal.X(), normal.Y(), normal.Z())
    centre, _ = centre_and_area(face)
    planes = [dict(p) for p in ORIGIN_PLANES]
    planes += [{"name": d["name"], "origin": tuple(d["plane"]["origin"]), "normal": tuple(d["plane"]["normal"])} for d in datums]
    found = []
    for plane in planes:
        length = math.sqrt(_dot(plane["normal"], plane["normal"])) or 1.0
        pn = tuple(c / length for c in plane["normal"])
        if abs(_dot(pn, n)) < 1 - 1e-6:
            continue
        distance = _dot(tuple(c - o for c, o in zip(centre, plane["origin"])), pn)
        if abs(distance) < TOLERANCE:
            continue
        found.append({**plane, "normal": pn, "distance": distance})
    return sorted(found, key=lambda p: abs(p["distance"]))


def counterpart(topology, face, plane: dict):
    """The face of the model that mirrors `face` in `plane`, or None."""
    normal = planar_normal(face)
    n = (normal.X(), normal.Y(), normal.Z())
    centre, area = centre_and_area(face)
    mirrored = tuple(c - 2 * plane["distance"] * k for c, k in zip(centre, plane["normal"]))
    scale = max(1.0, area**0.5)
    for _, other in topology.faces():
        if other.IsSame(face):
            continue
        other_normal = planar_normal(other)
        if other_normal is None or _dot((other_normal.X(), other_normal.Y(), other_normal.Z()), n) > -1 + 1e-6:
            continue
        other_centre, other_area = centre_and_area(other)
        if abs(other_area - area) > TOLERANCE * max(1.0, area):
            continue
        if math.dist(other_centre, mirrored) <= TOLERANCE * scale:
            return other
    return None


def symmetric_faces(topology, faces: list, datums) -> list:
    """The faces that move together for a symmetric push/pull of `faces` (a selection of solid faces)."""
    if any(planar_normal(f) is None for f in faces):
        raise OperationError("Symmetric push/pull works on flat faces only")
    if len(faces) == 2:
        a, b = (planar_normal(f) for f in faces)
        if not a.IsOpposite(b, 1e-6):
            raise OperationError("Symmetric push/pull of two faces needs two parallel faces that face away from each other")
        return list(faces)
    if len(faces) != 1:
        raise OperationError("Symmetric push/pull needs one face, two parallel faces, or a sketch face")
    candidates = mirror_candidates(faces[0], datums)
    if not candidates:
        raise OperationError("No origin plane or datum plane is parallel to this face; add a datum plane to push/pull about")
    for plane in candidates:
        other = counterpart(topology, faces[0], plane)
        if other is not None:
            return [faces[0], other]
    raise OperationError(f"The model has no matching face on the other side of the {candidates[0]['name']}; add a datum plane to push/pull about")

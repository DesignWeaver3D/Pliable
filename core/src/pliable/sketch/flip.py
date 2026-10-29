"""Flipping a sketch to the other side of its plane: the normal reverses and the geometry stays where it is in space."""

import copy

from .planes import frame


def flip_plane(plane: dict) -> dict:
    """The same plane seen from the other side: the normal reverses and the x direction is kept, so the frame's y axis
    (normal x x) reverses with it."""
    _, x, _, normal = frame(plane)
    return {**plane, "normal": [-c for c in normal], "xdir": list(x)}


def flip_sketch(content: dict) -> dict:
    """A copy of the sketch with its plane flipped and its data converted so every point keeps its place in space.

    The reversed normal makes the sketch's v axis run the opposite way (u is kept), so every stored v becomes -v. Mirroring
    the plane coordinates also turns counterclockwise into clockwise, and arcs and elliptical arcs run counterclockwise from
    their start to their end, so those two end points swap. Everything else is unchanged because it does not depend on the
    way v runs: lengths, radii, angles (measured between line directions, with an `outside` flag that does not change),
    symmetric, tangent, point-line distances (the side is taken from the points as they lie) and so on. Only the display
    position of a dimension's text (`place`) is a plane coordinate and is converted like a point."""
    flipped = copy.deepcopy(content)
    flipped["plane"] = flip_plane(flipped["plane"])
    for p in flipped.get("points", []):
        p["v"] = -p["v"] if p["v"] else 0.0
    for e in flipped.get("entities", []):
        if e["type"] == "arc" or (e["type"] == "ellipse" and "start" in e):
            e["start"], e["end"] = e["end"], e["start"]
    for c in flipped.get("constraints", []):
        if c.get("place"):
            c["place"] = [c["place"][0], -c["place"][1] if c["place"][1] else 0.0]
    return flipped

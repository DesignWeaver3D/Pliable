"""Moving and turning a kept sketch as a whole: the same arrows and rings as moving a solid, applied to the sketch's plane."""

from OCP.gp import gp_Dir, gp_Pnt, gp_Vec

from .sketch import frame
from .tools.move_body import move_handles, turn_and_shift

NAMES = ("dx", "dy", "dz", "rx", "ry", "rz")


def move_values(raw: dict) -> dict[str, float]:
    return {name: float(raw.get(name) or 0.0) for name in NAMES}


def world_box(content: dict) -> tuple[list[float], list[float]]:
    """The box round the sketch's points in model space."""
    origin, x, y, _ = frame(content["plane"])
    corners = [[origin[k] + p["u"] * x[k] + p["v"] * y[k] for k in range(3)] for p in content.get("points", [])] or [list(origin)]
    return [min(c[k] for c in corners) for k in range(3)], [max(c[k] for c in corners) for k in range(3)]


def moved_plane(content: dict, values: dict[str, float]) -> dict:
    """The sketch's plane turned about the middle of the sketch by rx, ry, rz (X, then Y, then Z), then shifted by dx, dy, dz."""
    lo, hi = world_box(content)
    trsf = turn_and_shift(gp_Pnt(*((a + b) / 2 for a, b in zip(lo, hi))), gp_Vec(values["dx"], values["dy"], values["dz"]), [values[n] for n in ("rx", "ry", "rz")])
    plane = content["plane"]
    origin = gp_Pnt(*plane["origin"]).Transformed(trsf)
    return {
        **plane,
        "origin": [origin.X(), origin.Y(), origin.Z()],
        "normal": list(gp_Dir(*plane["normal"]).Transformed(trsf).Coord()),
        "xdir": list(gp_Dir(*plane["xdir"]).Transformed(trsf).Coord()),
    }


def handles_for(content: dict, values: dict[str, float]) -> list[dict]:
    lo, hi = world_box(content)
    return [h.to_json(values[h.param], values) for h in move_handles(lo, hi, values)]

"""The Linear array tool: a grid of copies in two directions (columns along the first step, rows along the second)."""

import math

from OCP.gp import gp_Vec

from ..ops import MIN_DISTANCE, OperationError
from ..shared.arrays import _fuse_copies, _grid_counts, _grid_transforms
from ..shared.bodies import _body_bounds
from ..tools import Accepts, Handle, Param, register, Tool


def _unit(v, fallback):
    length = math.sqrt(sum(c * c for c in v))
    return tuple(c / length for c in v) if length > 1e-9 else fallback


def _spacing_handle(label, names, step, centre, fallback):
    """The grip on the second copy of one direction (the first step from the source): dragging it along that direction changes the spacing (the step vector keeps its direction)."""
    u = _unit(step, fallback)
    k = max(range(3), key=lambda i: abs(u[i]))  # the dominant axis carries the handle's value; the other two move with it
    anchor = tuple(centre[i] + step[i] for i in range(3))
    links = tuple((names[i], u[i]) for i in range(3) if i != k)
    return Handle(names[k], label, anchor, u, scale=u[k], links=links)


def _offset_handle(label, param, axis, step, centre, hi):
    """An arrow on the second copy for one offset component of a step: up (axis 2) from the top of that copy, or out of its side along x or y."""
    anchor = tuple(centre[i] + step[i] for i in range(3))
    anchor = tuple(hi[i] + step[i] if i == axis else anchor[i] for i in range(3))
    direction = tuple(1.0 if i == axis else 0.0 for i in range(3))
    return Handle(param, label, anchor, direction)


@register
class LinearArray(Tool):
    """Copies of the chosen body (the whole model when no face is selected) in a grid, fused with it. `count` columns along (dx, dy, dz) and `rows` along (dx2, dy2, dz2); each count includes the original."""

    id = "linear_array"
    whole_model_needs_one_body = True
    label = "Linear array"
    description = (
        "Makes copies of a body in a grid of columns and rows and fuses them. Select any face of the body, or nothing for the whole model; select only the round walls of holes or bosses to copy just those features; the counts include the original. "
        "Set rows to 1 for a single line."
    )
    accepts = Accepts(faces=(0, None))
    # The card order: the columns group (count, spacing, Z offset), the rows group, then the two planar shifts (Y for each column step, X for each row step).
    params = [
        Param("count", "number", 3),
        Param("dx", "length", 20),
        Param("dz", "length"),
        Param("rows", "number", 3),
        Param("dy2", "length", 20),
        Param("dz2", "length"),
        Param("dy", "length"),
        Param("dx2", "length"),
    ]
    move_vector = ("dx", "dy", "dz")

    def handles(self, topology, selection, values):
        lo, hi = _body_bounds(topology, selection)
        centre = [(a + b) / 2 for a, b in zip(lo, hi)]
        step1 = (values["dx"], values["dy"], values["dz"])
        step2 = (values["dx2"], values["dy2"], values["dz2"])
        try:
            columns, rows = _grid_counts(values["count"], values["rows"])
        except OperationError:
            return []
        out = [
            _spacing_handle("Column spacing", ("dx", "dy", "dz"), step1, centre, (1.0, 0.0, 0.0)),
            _spacing_handle("Row spacing", ("dx2", "dy2", "dz2"), step2, centre, (0.0, 1.0, 0.0)),
            _offset_handle("Column Z-offset", "dz", 2, step1, centre, hi),
            _offset_handle("Row Z-offset", "dz2", 2, step2, centre, hi),
            _offset_handle("Column Y planar shift", "dy", 1, step1, centre, hi),
            _offset_handle("Row X planar shift", "dx2", 0, step2, centre, hi),
        ]
        diagonal = tuple(a + b for a, b in zip(step1, step2))  # one more column and one more row
        size = math.sqrt(sum(c * c for c in diagonal))
        if size > MIN_DISTANCE:
            corner = tuple(centre[i] + step1[i] * (columns - 1) + step2[i] * (rows - 1) for i in range(3))
            # A cube grip: dragged in the plane of the two steps it sets columns and rows independently (the view reads `plane`);
            # when the steps are parallel there is no plane, so it stays an arrow along the diagonal.
            cross = (step1[1] * step2[2] - step1[2] * step2[1], step1[2] * step2[0] - step1[0] * step2[2], step1[0] * step2[1] - step1[1] * step2[0])
            grid = math.sqrt(sum(c * c for c in cross)) > MIN_DISTANCE
            out.append(Handle("count", "Columns and rows", corner, diagonal, scale=1 / size, min=1, unit="", links=(("rows", 1 / size),),
                              kind="resize" if grid else "arrow", plane=(step1, step2) if grid else None))
        return out

    def run(self, topology, selection, values, preview):
        columns, rows = _grid_counts(values["count"], values["rows"])
        step1 = gp_Vec(values["dx"], values["dy"], values["dz"])
        step2 = gp_Vec(values["dx2"], values["dy2"], values["dz2"])
        if columns > 1 and step1.Magnitude() < MIN_DISTANCE:
            raise OperationError("Give a non-zero column step")
        if rows > 1 and step2.Magnitude() < MIN_DISTANCE:
            raise OperationError("Give a non-zero row step")
        return _fuse_copies(topology, selection, _grid_transforms(columns, rows, step1, step2))

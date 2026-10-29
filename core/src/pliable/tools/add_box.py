"""The Add box tool."""

from OCP.BRepPrimAPI import BRepPrimAPI_MakeBox
from OCP.gp import gp_Pnt

from ..ops import MIN_DISTANCE, OperationError
from ..shared.primitives import _position_handles, _turned, _with_rotation, ROTATION
from ..shared.solids import _add_material, _new_body, finish, NEW_BODY
from ..tools import Accepts, Handle, Param, register, Tool


@register
class AddBox(Tool):
    """A box added as a new body (new_body 0 joins it to the model), given by its minimum corner and size."""

    id = "add_box"
    body_kind = "Box"
    label = "Add box"
    description = "Adds a box, given by its corner and size. Nothing needs to be selected; new_body 1 keeps it separate, 0 joins it to the model."
    placement = ("x", "y", "z")
    accepts = Accepts()
    params = [
        Param("width", "length", 10),
        Param("depth", "length", 10),
        Param("height", "length", 10),
        Param("x", "length"),
        Param("y", "length"),
        Param("z", "length"),
        *ROTATION, NEW_BODY,
    ]

    starts_from = "tool"

    def anchors(self, values):
        w, d, h = values["width"], values["depth"], values["height"]
        found = [("Corner (lowest X, Y and Z)", (0, 0, 0)), ("Center", (w / 2, d / 2, h / 2)), ("Bottom center", (w / 2, d / 2, 0)), ("Top center", (w / 2, d / 2, h))]
        found += [("Center of low X face", (0, d / 2, h / 2)), ("Center of high X face", (w, d / 2, h / 2)), ("Center of low Y face", (w / 2, 0, h / 2)), ("Center of high Y face", (w / 2, d, h / 2))]
        for ix in (0, 1):
            for iy in (0, 1):
                for iz in (0, 1):
                    if (ix, iy, iz) != (0, 0, 0):
                        found.append((f"Corner ({'high' if ix else 'low'} X, {'high' if iy else 'low'} Y, {'high' if iz else 'low'} Z)", (ix * w, iy * d, iz * h)))
        # Edge midpoints: two coordinates at a low/high end, the third in the middle.
        for axis, name in enumerate("XYZ"):
            others = [i for i in range(3) if i != axis]
            for a in (0, 1):
                for b in (0, 1):
                    at = [w / 2, d / 2, h / 2][:]
                    size = (w, d, h)
                    at[others[0]], at[others[1]] = a * size[others[0]], b * size[others[1]]
                    found.append((f"Middle of {name} edge ({'high' if a else 'low'} {'XYZ'[others[0]]}, {'high' if b else 'low'} {'XYZ'[others[1]]})", tuple(at)))
        return found

    def handles(self, topology, selection, values):
        x, y, z, w, d, h = (values[k] for k in ("x", "y", "z", "width", "depth", "height"))
        cx, cy, cz = x + w / 2, y + d / 2, z + h / 2
        # One grip on each of the six faces. A high face grows its own side; a low face grows the other way and moves
        # the origin by the same amount, so the opposite face stays where it is.
        faces = [
            ("width", "Resize width (high X face)", (x + w, cy, cz), (1, 0, 0), ()),
            ("width", "Resize width (low X face, moves the origin)", (x, cy, cz), (-1, 0, 0), (("x", -1.0),)),
            ("depth", "Resize depth (high Y face)", (cx, y + d, cz), (0, 1, 0), ()),
            ("depth", "Resize depth (low Y face, moves the origin)", (cx, y, cz), (0, -1, 0), (("y", -1.0),)),
            ("height", "Resize height (top face)", (cx, cy, z + h), (0, 0, 1), ()),
            ("height", "Resize height (bottom face, moves the origin)", (cx, cy, z), (0, 0, -1), (("z", -1.0),)),
        ]
        return _with_rotation([
            *(Handle(param, label, anchor, direction, min=MIN_DISTANCE, kind="resize", links=links) for param, label, anchor, direction, links in faces),
            *_position_handles(values, max(w, d, h)),
        ], values, max(w, d, h))

    def make(self, values):
        if min(values["width"], values["depth"], values["height"]) < MIN_DISTANCE:
            raise OperationError("The box sizes must be positive")
        return _turned(BRepPrimAPI_MakeBox(gp_Pnt(values["x"], values["y"], values["z"]), values["width"], values["depth"], values["height"]).Shape(), values)

    def combines(self, topology, selection, values):
        return None if _new_body(values) else "all"

    def run(self, topology, selection, values, preview):
        return finish(_add_material(topology.shape, self.make(values), _new_body(values)))

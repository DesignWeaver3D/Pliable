"""The Mirror tool."""

from OCP.BRepBuilderAPI import BRepBuilderAPI_Transform
from OCP.gp import gp_Ax2, gp_Dir, gp_Pnt, gp_Trsf, gp_Vec

from ..ops import OperationError
from ..shared.bodies import _body_bounds, _chosen_solids
from ..shared.faces import _PlanarFace, _plane_axes
from ..shared.solids import _combine, _compound, finish
from ..tools import Accepts, Handle, Param, Selection, register

PLANE_CHOICES = ("Selected face", "XY origin plane", "XZ origin plane", "YZ origin plane", "Picked plane")  # the value is the index
ORIGIN_NORMALS = {1: (0, 0, 1), 2: (0, 1, 0), 3: (1, 0, 0)}


@register
class Mirror(_PlanarFace):
    """Mirror the selected bodies (the whole model when none are selected) across a plane and join the copy. The plane is the selected flat face, an
    origin plane, or a picked plane (a datum plane or any flat face: its point px, py, pz and normal nx, ny, nz); `offset` moves it along its normal."""

    id = "mirror"
    whole_model_needs_one_body = True
    label = "Mirror"
    description = (
        "Mirrors bodies across a plane and joins the copy. Select bodies in the list (or nothing for the whole model) and optionally one flat face; "
        "choose the plane: the selected face, an origin plane, or a picked plane (Pick plane, or a datum plane button); offset moves the plane."
    )
    accepts = Accepts(faces=(0, 1), bodies=(0, None))
    params = [
        Param("offset", "length"),
        Param("plane", "number", 0, options=PLANE_CHOICES),
        Param("px", "length"),
        Param("py", "length"),
        Param("pz", "length"),
        Param("nx", "number"),
        Param("ny", "number"),
        Param("nz", "number", 1),
    ]
    pick_plane = ("px", "py", "pz", "nx", "ny", "nz", "plane")  # the form's Pick plane and datum buttons fill these and choose "Picked plane"

    def _plane(self, topology, selection, values) -> tuple[gp_Pnt, gp_Dir]:
        choice = int(round(values["plane"]))
        if choice == 0:
            if not selection.faces:
                raise OperationError("Select a flat face, or choose another plane")
            centre, normal, _, _ = _plane_axes(topology.face(selection.faces[0]))
            return centre, normal
        if choice in ORIGIN_NORMALS:
            return gp_Pnt(0, 0, 0), gp_Dir(*ORIGIN_NORMALS[choice])
        if choice != 4:
            raise OperationError("Unknown plane choice")
        direction = gp_Vec(values["nx"], values["ny"], values["nz"])
        if direction.Magnitude() < 1e-9:
            raise OperationError("The picked plane has no direction")
        return gp_Pnt(values["px"], values["py"], values["pz"]), gp_Dir(direction)

    def handles(self, topology, selection, values):
        # One arrow along the plane's normal, on the plane where it is nearest the bodies' middle; it follows the offset.
        try:
            centre, normal = self._plane(topology, selection, values)
        except OperationError:
            return []
        lo, hi = _body_bounds(topology, Selection(bodies=selection.bodies))
        middle = gp_Vec(gp_Pnt(*((a + b) / 2 for a, b in zip(lo, hi))), centre)
        n = gp_Vec(normal)
        foot = gp_Pnt(*((a + b) / 2 for a, b in zip(lo, hi))).Translated(n.Multiplied(middle.Dot(n) + values["offset"]))
        return [Handle("offset", "Mirror plane offset", (foot.X(), foot.Y(), foot.Z()), (normal.X(), normal.Y(), normal.Z()))]

    def run(self, topology, selection, values, preview):
        centre, normal = self._plane(topology, selection, values)
        centre = centre.Translated(gp_Vec(normal).Multiplied(values["offset"]))
        transform = gp_Trsf()
        transform.SetMirror(gp_Ax2(centre, normal))
        source = topology.shape
        if selection.bodies:
            source = _compound(_chosen_solids(topology, Selection(bodies=selection.bodies)))
        mirrored = BRepBuilderAPI_Transform(source, transform, True).Shape()
        return finish(_combine(topology.shape, mirrored, fuse=True))

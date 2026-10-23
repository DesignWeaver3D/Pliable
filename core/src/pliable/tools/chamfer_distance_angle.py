"""The Chamfer (distance and angle) tool."""

import math

from ..ops import MIN_DISTANCE, OperationError
from ..shared.faces import _chamfer_with_face
from ..tools import Accepts, Param, register, Tool


@register
class ChamferDistanceAngle(Tool):
    """Chamfer edges by a distance along the selected reference face and the angle the bevel makes with it."""

    id = "chamfer_distance_angle"
    label = "Chamfer (distance and angle)"
    description = "Bevels edges with a distance on one face and an angle. Select one face (it sets the side the distance is measured on) and one or more of its edges."
    accepts = Accepts(faces=(1, 1), edges=(1, None))
    params = [Param("distance", "length", 2), Param("angle", "angle", 45)]

    def run(self, topology, selection, values, preview):
        if values["distance"] < MIN_DISTANCE or not 0 < values["angle"] < 90:
            raise OperationError("Give a positive distance and an angle between 0 and 90 degrees")
        return _chamfer_with_face(topology, selection, lambda m, e, f: m.AddDA(values["distance"], math.radians(values["angle"]), e, f))

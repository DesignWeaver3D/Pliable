"""Measurements of a whole body (a solid chosen from the body list): its volume and, from a material density, its mass.

Lengths are millimetres, so volume is in mm3. A density is in kilograms per cubic metre (see the app's materials),
and 1 kg/m3 is 1e-6 g/mm3, so mass in grams = volume * density * 1e-6.
"""

from OCP.BRepGProp import BRepGProp
from OCP.GProp import GProp_GProps

from .ops import OperationError, solids_of
from .topology import Topology

GRAMS_PER_MM3_PER_KG_PER_M3 = 1e-6


def mass_grams(volume_mm3: float, density_kg_m3: float) -> float:
    return volume_mm3 * density_kg_m3 * GRAMS_PER_MM3_PER_KG_PER_M3


def measure_body(topology: Topology, body_id: int, density: float | None = None) -> dict:
    """A measured item of kind "body": Volume, and Mass when a density (kg/m3) is given."""
    index = topology.bodies.find(body_id)
    if index is None:
        raise OperationError(f"no body {body_id}")
    solid = solids_of(topology.shape)[index]
    props = GProp_GProps()
    BRepGProp.VolumeProperties_s(solid, props)
    volume = props.Mass()
    centre = props.CentreOfMass()
    rows = [{"label": "Volume", "value": volume, "unit": " mm³"}]
    if density is not None:
        rows.append({"label": "Mass", "value": mass_grams(volume, density), "unit": " g"})
    return {"kind": "body", "id": body_id, "title": topology.bodies.bodies[index].name, "rows": rows, "anchor": [centre.X(), centre.Y(), centre.Z()], "dimensions": []}

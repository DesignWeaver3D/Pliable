"""Volume of a shape: one place for the OCC volume-properties call.

The value is signed: a solid with reversed faces gives a negative volume. Callers that need a magnitude apply abs().
"""

from OCP.BRepGProp import BRepGProp
from OCP.GProp import GProp_GProps
from OCP.TopoDS import TopoDS_Shape


def volume_props(shape: TopoDS_Shape) -> GProp_GProps:
    """The volume properties of `shape` (Mass() is the signed volume, CentreOfMass() its center)."""
    props = GProp_GProps()
    BRepGProp.VolumeProperties_s(shape, props)
    return props


def volume_of(shape: TopoDS_Shape) -> float:
    """The signed volume of `shape` in mm3."""
    return volume_props(shape).Mass()

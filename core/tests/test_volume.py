import math

from OCP.BRepPrimAPI import BRepPrimAPI_MakeBox, BRepPrimAPI_MakeCylinder
from OCP.TopAbs import TopAbs_REVERSED
from OCP.gp import gp_Ax2, gp_Dir, gp_Pnt

from pliable.bodies import _volume as bodies_volume
from pliable.files import _volume as files_volume
from pliable.ops import _volume_of
from pliable.volume import volume_of, volume_props


def reversed_box():
    return BRepPrimAPI_MakeBox(2, 3, 4).Shape().Reversed()


def test_box_and_cylinder_volumes():
    assert abs(volume_of(BRepPrimAPI_MakeBox(2, 3, 4).Shape()) - 24) < 1e-9
    cylinder = BRepPrimAPI_MakeCylinder(gp_Ax2(gp_Pnt(0, 0, 0), gp_Dir(0, 0, 1)), 2, 5).Shape()
    assert abs(volume_of(cylinder) - math.pi * 4 * 5) < 1e-6


def test_props_mass_and_center():
    props = volume_props(BRepPrimAPI_MakeBox(2, 3, 4).Shape())
    assert abs(props.Mass() - 24) < 1e-9
    assert abs(props.CentreOfMass().X() - 1) < 1e-9


def test_reversed_solid_is_signed_and_callers_keep_their_sign():
    shape = reversed_box()
    assert shape.Orientation() == TopAbs_REVERSED
    assert volume_of(shape) < 0
    assert _volume_of(shape) == volume_of(shape)  # ops: signed
    assert files_volume(shape) == volume_of(shape)  # files: signed
    assert bodies_volume(shape) == abs(volume_of(shape)) > 0  # bodies: magnitude

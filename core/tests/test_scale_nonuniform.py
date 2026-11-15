"""Scale body with separate X, Y and Z factors (world axes, about the same center as the uniform scale)."""

import pytest
from build123d import Box, Cylinder
from OCP.Bnd import Bnd_Box
from OCP.BRepBndLib import BRepBndLib
from OCP.BRepCheck import BRepCheck_Analyzer
from OCP.BRepGProp import BRepGProp
from OCP.GProp import GProp_GProps

from pliable.ops import OperationError, solids_of
from pliable.tools import Selection, get_tool
from pliable.topology import Topology
from pliable.volume import volume_of


def _bounds(shape):
    box = Bnd_Box()
    BRepBndLib.AddOptimal_s(shape, box, False, False)
    return [box.CornerMin().X(), box.CornerMin().Y(), box.CornerMin().Z(), box.CornerMax().X(), box.CornerMax().Y(), box.CornerMax().Z()]


def _scale(shape, selection=None, **params):
    return get_tool("scale_body").execute(Topology(shape), selection or Selection(), params, preview=False)


def test_a_single_factor_still_scales_evenly():
    box = Box(10, 20, 30).wrapped
    result = _scale(box, factor=2)
    assert volume_of(result.shape) == pytest.approx(10 * 20 * 30 * 8)


def test_non_uniform_scale_of_a_box():
    box = Box(10, 20, 30).wrapped
    result = _scale(box, scaling=1, factor=2, factor_y=0.5, factor_z=3)
    assert BRepCheck_Analyzer(result.shape).IsValid()
    assert len(solids_of(result.shape)) == 1
    lo_hi = _bounds(result.shape)
    assert [lo_hi[3] - lo_hi[0], lo_hi[4] - lo_hi[1], lo_hi[5] - lo_hi[2]] == pytest.approx([20, 10, 90], abs=1e-6)
    assert volume_of(result.shape) == pytest.approx(10 * 20 * 30 * 3, rel=1e-6)


def test_non_uniform_scale_goes_about_the_body_center_when_bodies_are_selected():
    from pliable.bodies import box_of  # noqa: F401

    shape = Box(10, 10, 10).moved(__import__("build123d").Location((100, 0, 0))).wrapped
    topology = Topology(shape)
    body = topology.bodies.bodies[0].id
    result = get_tool("scale_body").execute(topology, Selection(bodies=[body]), {"scaling": 1, "factor": 2, "factor_y": 1, "factor_z": 3}, preview=False)
    b = _bounds(result.shape)
    assert [(b[0] + b[3]) / 2, (b[1] + b[4]) / 2, (b[2] + b[5]) / 2] == pytest.approx([100, 0, 0], abs=1e-6)
    assert [b[3] - b[0], b[4] - b[1], b[5] - b[2]] == pytest.approx([20, 10, 30], abs=1e-6)


def test_non_uniform_scale_of_a_cylinder_is_a_valid_elliptical_solid():
    cylinder = Cylinder(5, 20).wrapped
    result = _scale(cylinder, scaling=1, factor=2, factor_y=1, factor_z=1.5)
    assert BRepCheck_Analyzer(result.shape).IsValid()
    assert len(solids_of(result.shape)) == 1
    import math

    props = GProp_GProps()
    BRepGProp.VolumeProperties_s(result.shape, props, 1e-7, False, False)  # the default integration of a spline surface is only good to about 1 %
    assert props.Mass() == pytest.approx(math.pi * 25 * 20 * 2 * 1 * 1.5, rel=1e-4)
    b = _bounds(result.shape)
    assert [b[3] - b[0], b[4] - b[1], b[5] - b[2]] == pytest.approx([20, 10, 30], abs=1e-3)


def test_equal_factors_in_non_uniform_mode_are_the_uniform_scale():
    box = Box(10, 20, 30).wrapped
    result = _scale(box, scaling=1, factor=2, factor_y=2, factor_z=2)
    assert volume_of(result.shape) == pytest.approx(10 * 20 * 30 * 8)


@pytest.mark.parametrize("params", [{"scaling": 1, "factor": 2, "factor_y": 0, "factor_z": 1}, {"scaling": 1, "factor": 1, "factor_y": 1, "factor_z": 5000}])
def test_a_factor_out_of_range_is_refused(params):
    with pytest.raises(OperationError):
        _scale(Box(10, 10, 10).wrapped, **params)


def test_non_uniform_scale_of_a_surface_body():
    from test_surface_bodies import surface_document, is_surface

    document = surface_document()
    surface_id = document.current.bodies.bodies[1].id
    before = _bounds(solids_of(document.current.shape)[1])
    result = get_tool("scale_body").execute(document.current, Selection(bodies=[surface_id]), {"scaling": 1, "factor": 2, "factor_y": 1, "factor_z": 3}, preview=False)
    after = solids_of(result.shape)
    assert [is_surface(b) for b in after] == [False, True]
    b = _bounds(after[1])
    assert b[3] - b[0] == pytest.approx(2 * (before[3] - before[0]), abs=1e-6)
    assert b[5] - b[2] == pytest.approx(3 * (before[5] - before[2]), abs=1e-6)

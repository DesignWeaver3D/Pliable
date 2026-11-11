"""Mirror of a shelled, rounded body across a plane it touches: merging faces after the fuse used to break the result."""

from pathlib import Path

from OCP.BRep import BRep_Builder
from OCP.BRepGProp import BRepGProp
from OCP.BRepTools import BRepTools
from OCP.GProp import GProp_GProps
from OCP.TopoDS import TopoDS_Shape

from pliable.ops import solids_of
from pliable.topology import Topology
from pliable.tools import Selection, get_tool

FIXTURE = Path(__file__).parent / "data" / "shelled_rounded_body.brep"  # x 0..50, y -20..0, z 0..30, filleted, shelled open at the top


def volume(shape) -> float:
    props = GProp_GProps()
    BRepGProp.VolumeProperties_s(shape, props)
    return props.Mass()


def load() -> Topology:
    shape = TopoDS_Shape()
    assert BRepTools.Read_s(shape, str(FIXTURE), BRep_Builder())
    return Topology(shape)


def test_mirror_across_the_plane_it_touches_joins_into_one_body():
    body = load()
    one = volume(body.shape)
    result = get_tool("mirror").execute(body, Selection(), {"plane": 2}, preview=False)  # XZ origin plane: the body's y = 0 side lies on it
    assert len(solids_of(result.shape)) == 1
    assert abs(volume(result.shape) - 2 * one) < 1e-3 * one


def test_mirror_across_the_other_origin_plane_still_works():
    body = load()
    result = get_tool("mirror").execute(body, Selection(), {"plane": 3}, preview=False)  # YZ
    assert len(solids_of(result.shape)) == 1

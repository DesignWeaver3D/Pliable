"""Up to face, Up to last and Through all add or cut by Subtract and Flip like a plain pull (through Tool.execute)."""

import pytest
from build123d import Box, Pos
from OCP.BRep import BRep_Builder
from OCP.BRepGProp import BRepGProp
from OCP.GProp import GProp_GProps
from OCP.TopoDS import TopoDS_Compound

from pliable.ops import OperationError, planar_normal, solids_of
from pliable.tools import Selection, get_tool
from pliable.topology import Topology


def volume(shape) -> float:
    total = 0.0
    for s in solids_of(shape):
        props = GProp_GProps()
        BRepGProp.VolumeProperties_s(s, props)
        total += props.Mass()
    return total


def scene(*parts) -> Topology:
    compound, builder = TopoDS_Compound(), BRep_Builder()
    builder.MakeCompound(compound)
    for part in parts:
        builder.Add(compound, part.wrapped)
    return Topology(compound)


def face_at(topology, z, normal_z):
    for i, face in topology.faces():
        normal = planar_normal(face)
        if normal is None or abs(normal.Z() - normal_z) > 1e-6:
            continue
        if abs(face_z(face) - z) < 1e-6:
            return i
    raise AssertionError("no such face")


def face_z(face) -> float:
    from OCP.Bnd import Bnd_Box
    from OCP.BRepBndLib import BRepBndLib

    box = Bnd_Box()
    BRepBndLib.Add_s(face, box)
    return box.CornerMin().Z()


def two_blocks() -> Topology:
    return scene(Box(40, 30, 20), Pos(0, 0, 40) * Box(40, 30, 20))  # z -10..10 and 30..50


def pull(topology, face, preview=False, **params):
    return get_tool("push_pull").execute(topology, Selection(faces=[face]), {"distance": 5, **params}, preview=preview)


EXTENTS = ["last", "through"]


@pytest.mark.parametrize("extent", EXTENTS)
def test_flip_off_still_fuses(extent):
    topology = two_blocks()
    result = pull(topology, face_at(topology, 10, 1), extent=extent)
    assert [round(volume(s)) for s in [result.shape]] == [72000]


@pytest.mark.parametrize("extent", EXTENTS)
@pytest.mark.parametrize("params", [{"flip": 1}, {"mode": "subtract"}])
def test_flip_or_subtract_cuts_the_body_above(extent, params):
    topology = two_blocks()
    result = pull(topology, face_at(topology, 10, 1), extent=extent, **params)
    assert round(volume(result.shape)) == 24000
    assert len(solids_of(result.shape)) == 1


@pytest.mark.parametrize("extent", EXTENTS)
def test_mode_add_ignores_flip_and_new_stays_separate(extent):
    topology = two_blocks()
    face = face_at(topology, 10, 1)
    assert round(volume(pull(topology, face, extent=extent, mode="add", flip=1).shape)) == 72000
    assert len(solids_of(pull(topology, face, extent=extent, mode="new").shape)) == 3


@pytest.mark.parametrize("params", [{"flip": 1}, {"mode": "subtract"}])
def test_up_to_face_cuts(params):
    topology = two_blocks()
    result = pull(topology, face_at(topology, 10, 1), target=face_at(topology, 50, 1), **params)
    assert round(volume(result.shape)) == 24000


def test_up_to_face_without_flip_fuses():
    topology = two_blocks()
    result = pull(topology, face_at(topology, 10, 1), target=face_at(topology, 30, -1))
    assert round(volume(result.shape)) == 24000 + 24000 + 40 * 30 * 20


@pytest.mark.parametrize("extent", EXTENTS)
def test_a_cut_that_reaches_nothing(extent):
    # the pad of the top block's top face runs past nothing, so look at a pad that stays in free space: pull the lower block's top
    # up to the body, then subtract from a scene where the pad meets no solid
    topology = scene(Box(40, 30, 20), Pos(100, 0, 40) * Box(10, 10, 10))
    face = face_at(topology, 10, 1)
    # the far block lies outside the column of the face, so there is nothing ahead of it
    with pytest.raises(OperationError):
        pull(topology, face, extent=extent, mode="subtract")


def test_up_to_face_cut_that_removes_nothing_refuses_and_previews_a_notice():
    topology = two_blocks()
    face, target = face_at(topology, 10, 1), face_at(topology, 30, -1)  # the pad ends where the upper block begins
    with pytest.raises(OperationError):
        pull(topology, face, target=target, mode="subtract")
    result = pull(topology, face, preview=True, target=target, mode="subtract")
    assert result.notice
    assert result.cutters
    assert round(volume(result.shape)) == 48000

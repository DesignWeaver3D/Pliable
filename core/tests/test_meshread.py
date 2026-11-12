"""Reading triangulations in bulk must give what reading them node by node gives."""

import numpy as np
import pytest
from build123d import Box, Compound, Cylinder, Pos, Rot, Sphere, Torus
from OCP.BRep import BRep_Tool
from OCP.BRepBuilderAPI import BRepBuilderAPI_Copy
from OCP.TopLoc import TopLoc_Location

from pliable import meshread, meshing
from pliable.demos import load_demo
from pliable.meshread import MeshReader, vertex_normals
from pliable.tessellate import ANGULAR_DEFLECTION, linear_deflection
from pliable.topology import Topology


def meshed(shape):
    meshing.mesh(shape, linear_deflection(shape), ANGULAR_DEFLECTION)
    return shape


SHAPES = {
    "bracket": lambda: load_demo("bracket"),
    "plate": lambda: load_demo("perforated_plate"),
    "round": lambda: Compound([Sphere(5), Pos(30, 0, 0) * Torus(8, 2)]).wrapped,
    "moved and turned": lambda: Compound([Box(20, 20, 10) - Cylinder(3, 20), Pos(30, 5, 2) * Rot(20, 30, 40) * (Box(20, 20, 10) - Cylinder(3, 20))]).wrapped,
}


def same_arrays(fast, slow):
    assert (fast is None) == (slow is None)
    if fast is None:
        return
    assert [a.dtype for a in fast[:3]] == [np.float32, np.float32, np.uint32]
    assert fast[0].tobytes() == slow[0].tobytes()
    assert np.abs(fast[1] - slow[1]).max() < 1e-6
    assert fast[2].tobytes() == slow[2].tobytes()
    assert fast[3] == slow[3]


@pytest.mark.parametrize("name", SHAPES)
def test_bulk_reading_matches_node_by_node(name):
    shape = meshed(SHAPES[name]())
    fast, slow = MeshReader(shape), MeshReader(shape, bulk=False)
    count = 0
    for _, face in Topology(shape).faces():
        same_arrays(fast.face_arrays(face), slow.face_arrays(face))
        count += 1
    assert count and fast._table, "the stream was not understood, so nothing was read in bulk"


def test_an_unreadable_stream_falls_back_to_node_by_node(monkeypatch):
    shape = meshed(load_demo("bracket"))
    expected = [MeshReader(shape).face_arrays(face) for _, face in Topology(shape).faces()]
    for broken in (lambda shape: {}, lambda shape: 1 / 0):
        monkeypatch.setattr(meshread, "_dump", broken)
        reader = MeshReader(shape)
        for (_, face), wanted in zip(Topology(shape).faces(), expected):
            same_arrays(reader.face_arrays(face), wanted)


def test_computed_normals_match_the_kernels():
    shape = meshed(BRepBuilderAPI_Copy(load_demo("bracket"), True, False).Shape())
    for _, face in Topology(shape).faces():
        triangulation = BRep_Tool.Triangulation_s(face, TopLoc_Location())
        nodes, index, stored = meshread._by_node(triangulation)
        assert stored is None
        ours = vertex_normals(nodes, index)
        triangulation.ComputeNormals()
        theirs = meshread._by_node(triangulation)[2]
        assert np.abs(ours - theirs).max() < 1e-5


def test_stored_normals_are_read_from_the_stream():
    shape = meshed(BRepBuilderAPI_Copy(Sphere(5).wrapped, True, False).Shape())
    face = Topology(shape).face(0)
    BRep_Tool.Triangulation_s(face, TopLoc_Location()).ComputeNormals()
    table = meshread._dump(shape)
    assert table and all(entry[2] is not None for entry in table.values())
    same_arrays(MeshReader(shape).face_arrays(face), MeshReader(shape, bulk=False).face_arrays(face))

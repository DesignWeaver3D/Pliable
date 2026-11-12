"""Meshing a body: every face gets triangles, whichever algorithm does a face."""

import numpy as np
from OCP.BRep import BRep_Tool
from OCP.BRepBuilderAPI import BRepBuilderAPI_Copy
from OCP.BRepGProp import BRepGProp
from OCP.BRepMesh import BRepMesh_IncrementalMesh
from OCP.GProp import GProp_GProps
from OCP.TopLoc import TopLoc_Location

from pliable import meshing
from pliable.demos import load_demo
from pliable.meshread import MeshReader
from pliable.tessellate import ANGULAR_DEFLECTION, linear_deflection
from pliable.topology import Topology


def facts(shape):
    """Triangle count and triangle area of each face, None for a face without a mesh."""
    reader = MeshReader(shape)
    out = []
    for _, face in Topology(shape).faces():
        data = reader.face_arrays(face)
        if data is None:
            out.append(None)
            continue
        p, i = data[0].astype(np.float64), data[2].reshape(-1, 3)
        out.append((len(i), 0.5 * np.linalg.norm(np.cross(p[i[:, 1]] - p[i[:, 0]], p[i[:, 2]] - p[i[:, 0]]), axis=1).sum()))
    return out


def fresh(shape):
    return BRepBuilderAPI_Copy(shape, True, False).Shape()


def test_a_plate_with_many_holes_meshes_like_the_default_algorithm():
    plate = load_demo("perforated_plate")
    deflection = linear_deflection(plate)
    ours, default = fresh(plate), fresh(plate)
    assert sum(1 for _, f in Topology(ours).faces() if meshing._holes(f) >= meshing.MANY_HOLES) == 2  # top and bottom
    meshing.mesh(ours, deflection, ANGULAR_DEFLECTION)
    BRepMesh_IncrementalMesh(default, deflection, False, ANGULAR_DEFLECTION, True)
    a, b = facts(ours), facts(default)
    assert None not in a
    assert [f[0] for f in a] == [f[0] for f in b]
    assert np.allclose([f[1] for f in a], [f[1] for f in b], rtol=1e-9)
    for (_, face), (_, area) in zip(Topology(ours).faces(), a):
        props = GProp_GProps()
        BRepGProp.SurfaceProperties_s(face, props)
        assert abs(area - props.Mass()) <= 0.02 * props.Mass()


def test_faces_the_fast_algorithm_leaves_out_are_still_meshed(monkeypatch):
    # The faster algorithm is known to skip some faces (seen on the outlines of engraved text). Here it does nothing
    # at all, or fails outright; the default algorithm must still mesh every face.
    real = meshing.BRepMesh_IncrementalMesh

    def skips(*args):
        return None if len(args) == 2 else real(*args)  # called with a parameters object: the faster algorithm

    def fails(*args):
        if len(args) == 2:
            raise RuntimeError("no mesh")
        return real(*args)

    for stand_in in (skips, fails):
        monkeypatch.setattr(meshing, "BRepMesh_IncrementalMesh", stand_in)
        shape = fresh(load_demo("perforated_plate"))
        meshing.mesh(shape, linear_deflection(shape), ANGULAR_DEFLECTION)
        assert None not in facts(shape)


def test_meshed_faces_are_left_alone():
    shape = fresh(load_demo("bracket"))
    deflection = linear_deflection(shape)
    assert meshing.needs_mesh(shape, deflection)
    meshing.mesh(shape, deflection, ANGULAR_DEFLECTION)
    assert not meshing.needs_mesh(shape, deflection)
    before = [BRep_Tool.Triangulation_s(f, TopLoc_Location()) for _, f in Topology(shape).faces()]
    meshing.mesh(shape, deflection, ANGULAR_DEFLECTION)
    after = [BRep_Tool.Triangulation_s(f, TopLoc_Location()) for _, f in Topology(shape).faces()]
    assert all(x is y for x, y in zip(before, after))
    assert meshing.needs_mesh(shape, deflection / 4)  # a finer mesh is wanted: the faces count as unmeshed

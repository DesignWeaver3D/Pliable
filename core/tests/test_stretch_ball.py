"""Stretch keeps a sphere or torus a sphere or torus: where a face is one after the deformation it is stored as one."""

from types import SimpleNamespace

import numpy as np
import pytest
from build123d import Box, Cylinder, fillet, GeomType, Pos, Sphere, Torus
from OCP.BRepAdaptor import BRepAdaptor_Surface
from OCP.GeomAbs import GeomAbs_Sphere, GeomAbs_Torus

from pliable.stretch.body import Body
from pliable.stretch.deform import Deformer, ROUND
from pliable.stretch.falloff import Falloff, LINEAR
from pliable.stretch.field import Field, Move
from pliable.topology import Topology
from test_stretch_band import stretch, surface_types, valid
from test_features import volume
from test_stretch import face_with_normal

SHIFT = np.array([3.0, 4.0, 5.0])
TURN = Move(SHIFT, np.zeros(3), np.array([1.0, 1.0, 0.0]) / 2**0.5, 0.3)


def _deformer(solid, move):
    """A deformer for a body whose every face is rubber and lies where the share of the move is 1 (the move is rigid there)."""
    body = Body(solid.wrapped)
    zones = SimpleNamespace(protected_faces=set(), fixed=set(), protected_edges=set(), protected_vertices=set())
    field = Field(np.array([0.0, 0.0, 1.0]), Falloff(-100.0, -50.0, [], LINEAR), move, False)
    return body, Deformer(body, zones, [], field, 1e-4 * body.size)


@pytest.mark.parametrize("solid", [Torus(30, 5), Sphere(10) & (Pos(8, 0, 0) * Box(6, 6, 6))], ids=["torus", "sphere patch"])
def test_a_rigidly_moved_rubber_face_stays_a_sphere_or_torus(solid):
    body, deformer = _deformer(solid, TURN)
    round_faces = 0
    for number, face in enumerate(body.faces):
        kind = BRepAdaptor_Surface(face).GetType()
        if kind not in (GeomAbs_Sphere, GeomAbs_Torus):
            continue
        mode, surface = deformer._rubber_surface(number)
        assert mode == ROUND
        assert type(surface).__name__ == ("Geom_SphericalSurface" if kind == GeomAbs_Sphere else "Geom_ToroidalSurface")
        centre = deformer.field(np.zeros((1, 3)))[0]
        found = surface.Location()
        assert np.allclose([found.X(), found.Y(), found.Z()], centre, atol=0.02)
        round_faces += 1
    assert round_faces == 1


def test_stretching_beside_a_dome_keeps_it_a_sphere():
    capsule = Topology((Cylinder(10, 40) + Pos(0, 0, 20) * Sphere(10)).wrapped)
    r = stretch(capsule, [face_with_normal(capsule, [0.0, 0.0, -1.0])], dz=-10)
    assert valid(r.shape) and GeomAbs_Sphere in surface_types(r.shape)
    assert volume(r.shape) == pytest.approx(volume(capsule.shape) + 10 * np.pi * 100, rel=1e-6)


def test_stretching_beside_a_fillet_keeps_it_a_torus():
    rod = Topology(fillet(Cylinder(10, 40).edges().filter_by(GeomType.CIRCLE), 3).wrapped)
    r = stretch(rod, [face_with_normal(rod, [0.0, 0.0, 1.0])], dz=10)
    assert valid(r.shape)
    assert surface_types(r.shape).count(GeomAbs_Torus) == 2
    assert volume(r.shape) == pytest.approx(volume(rod.shape) + 10 * np.pi * 100, rel=1e-6)

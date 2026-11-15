"""Cutting a tool out of the model one body at a time gives the same bodies as cutting the whole model (bodycut.py)."""

from OCP.BRepGProp import BRepGProp
from OCP.BRepPrimAPI import BRepPrimAPI_MakeBox, BRepPrimAPI_MakeCylinder
from OCP.GProp import GProp_GProps
from OCP.gp import gp_Ax2, gp_Dir, gp_Pnt

from pliable.shared.bodycut import cut_reachable_bodies
from pliable.ops import solids_of
from pliable.shared.solids import _combine
from pliable.topology import Topology
from test_merge_scope import box, compound


def body_figures(shape):
    """Per body, in order: its volume, area and counts of faces, edges and vertices of its own (sharing between bodies does not show)."""
    out = []
    for solid in solids_of(shape):
        volume, area = GProp_GProps(), GProp_GProps()
        BRepGProp.VolumeProperties_s(solid, volume)
        BRepGProp.SurfaceProperties_s(solid, area)
        own = Topology(solid, bodies=())
        out.append((round(volume.Mass(), 6), round(area.Mass(), 6), own.face_count, own.edge_count, own.vertex_count))
    return sorted(out)


def drill(x, z, length, radius=1.5):
    return BRepPrimAPI_MakeCylinder(gp_Ax2(gp_Pnt(x, 5, z), gp_Dir(0, 0, 1)), radius, length).Shape()


def stack():
    upper = BRepPrimAPI_MakeBox(gp_Pnt(0, 0, 10), gp_Pnt(10, 10, 20)).Shape()
    return compound([box(0), upper, box(30), box(60)])


def test_a_cut_through_two_touching_bodies_equals_the_whole_model_cut_and_leaves_the_others_alone():
    shape = stack()
    tool = drill(5, -1, 30)
    each = cut_reachable_bodies(shape, tool)
    assert body_figures(each) == body_figures(_combine(shape, tool, fuse=False))
    before, after = solids_of(shape), solids_of(each)
    assert all(a.IsSame(b) for a, b in zip(before[2:], after[2:]))  # the bodies the tool does not reach are the very same bodies, in their places
    assert not any(a.IsSame(b) for a, b in zip(before[:2], after[:2]))


def test_a_cut_that_misses_every_body_changes_nothing_and_a_cut_that_splits_a_body_lists_its_parts():
    shape = stack()
    far = cut_reachable_bodies(shape, drill(500, 0, 10))
    assert all(a.IsSame(b) for a, b in zip(solids_of(shape), solids_of(far)))
    slab = BRepPrimAPI_MakeBox(gp_Pnt(28, 4, -1), gp_Pnt(42, 6, 11)).Shape()  # cuts body 2 (x 30 to 40) clean through into two parts
    split = cut_reachable_bodies(shape, slab)
    assert len(solids_of(split)) == len(solids_of(shape)) + 1
    assert body_figures(split) == body_figures(_combine(shape, slab, fuse=False))


def test_a_model_with_a_loose_face_or_one_body_is_cut_as_a_whole():
    single = box(0)
    tool = drill(5, -1, 30)
    assert body_figures(cut_reachable_bodies(single, tool)) == body_figures(_combine(single, tool, fuse=False))


def test_bodies_that_overlap_do_not_share_the_cut_wall():
    from pliable.bodydisplay import body_ranges

    shape = compound([box(0), box(0), box(30)])  # a copy lying on its original
    cut = cut_reachable_bodies(shape, drill(5, -1, 30))
    assert body_ranges(Topology(cut), solids_of(cut)) is not None  # no face, edge or vertex is held by two bodies
    assert body_figures(cut) == body_figures(_combine(shape, drill(5, -1, 30), fuse=False))


def test_a_surface_body_is_cut_like_the_rest_and_keeps_its_place():
    from test_merge_scope import open_shell

    shape = compound([box(0), open_shell(0), box(30)])  # a shell lying on the first body's faces
    tool = drill(5, -1, 30)
    cut = cut_reachable_bodies(shape, tool)
    assert len(solids_of(cut)) == 3
    assert body_figures(cut) == body_figures(_combine(shape, tool, fuse=False))
    assert solids_of(cut)[2].IsSame(solids_of(shape)[2])

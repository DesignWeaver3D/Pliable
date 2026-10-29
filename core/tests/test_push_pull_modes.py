"""Push/pull modes: auto add/subtract by drag direction, flip, explicit add/subtract/new, and the preview ghost."""

import pytest
from OCP.BRepGProp import BRepGProp
from OCP.GProp import GProp_GProps

from pliable import sketch
from pliable.demos import load_demo
from pliable.document import Document
from pliable.ops import OperationError, planar_normal, solids_of
from pliable.protocol import decode_binary
from pliable.server import Session
from pliable.tools import Selection, get_tool
from pliable.topology import Topology

RADIUS = 3.0
AREA = 3.14159265 * RADIUS**2
GAP = 5.0
# The six faces of the 40 x 30 x 20 block: (outward normal, a direction in the face, distance from the center).
FACES = [((1, 0, 0), (0, 1, 0), 20), ((-1, 0, 0), (0, 1, 0), 20), ((0, 1, 0), (1, 0, 0), 15), ((0, -1, 0), (1, 0, 0), 15), ((0, 0, 1), (1, 0, 0), 10), ((0, 0, -1), (1, 0, 0), 10)]


def _vol(shape) -> float:
    props = GProp_GProps()
    BRepGProp.VolumeProperties_s(shape, props)
    return props.Mass()


def volume(shape) -> float:
    return sum(_vol(s) for s in solids_of(shape))


def face_area(face) -> float:
    props = GProp_GProps()
    BRepGProp.SurfaceProperties_s(face, props)
    return props.Mass()


def loose_region(normal, xdir, reach, toward):
    """The block with a circular region GAP outside the face with the given outward normal. `toward` makes the region's
    own normal point into the block instead of away from it. Returns the shape and the region's face id."""
    sign = -1 if toward else 1
    plane = {"origin": [c * (reach + GAP) for c in normal], "normal": [c * sign for c in normal], "xdir": list(xdir)}
    sk = {"plane": plane, "points": [{"id": 1, "u": 0, "v": 0}], "entities": [{"id": 10, "type": "circle", "center": 1, "radius": RADIUS}], "constraints": []}
    shape, _ = sketch.add_regions(load_demo("block"), sk)
    face = next(i for i, f in Topology(shape).faces() if face_area(f) == pytest.approx(AREA, rel=1e-3))
    return shape, face


def run(shape, face, preview=False, **params):
    return get_tool("push_pull").execute(Topology(shape), Selection(faces=[face]), params, preview=preview)


BLOCK = volume(load_demo("block"))
TOP = loose_region((0, 0, 1), (1, 0, 0), 10, toward=False)  # a region 5 above the top face, facing up


@pytest.mark.parametrize("normal,xdir,reach", FACES)
def test_a_pull_along_the_normal_adds_and_a_push_against_it_cuts(normal, xdir, reach):
    shape, face = loose_region(normal, xdir, reach, toward=False)
    assert volume(run(shape, face, distance=4).shape) == pytest.approx(BLOCK + AREA * 4, rel=1e-3)
    assert volume(run(shape, face, distance=-(GAP + 3)).shape) == pytest.approx(BLOCK - AREA * 3, rel=1e-3)


@pytest.mark.parametrize("normal,xdir,reach", FACES)
def test_a_region_facing_the_block_adds_when_pulled_and_has_nothing_to_cut_when_pushed_away(normal, xdir, reach):
    shape, face = loose_region(normal, xdir, reach, toward=True)
    assert volume(run(shape, face, distance=GAP + 3).shape) == pytest.approx(BLOCK + AREA * GAP, rel=1e-3)  # only the part outside the block is new
    with pytest.raises(OperationError, match="Nothing to subtract"):
        run(shape, face, distance=-4)


def test_a_push_in_empty_space_changes_nothing_and_says_so():
    shape, face = TOP
    with pytest.raises(OperationError, match="Nothing to subtract"):
        run(shape, face, distance=-3)
    previewed = run(shape, face, preview=True, distance=-3)  # a drag preview keeps the model and carries the note instead of failing
    assert "Nothing to subtract" in previewed.notice
    assert volume(previewed.shape) == pytest.approx(BLOCK)


def test_flip_reverses_which_drag_direction_adds_and_subtracts():
    shape, face = TOP
    with pytest.raises(OperationError, match="Nothing to subtract"):
        run(shape, face, distance=4, flip=True)  # along the normal now subtracts, in empty space
    assert volume(run(shape, face, distance=-(GAP + 3), flip=True).shape) == pytest.approx(BLOCK + AREA * GAP, rel=1e-3)  # against it adds
    top = top_face(load_demo("block"))
    flipped = run(load_demo("block"), top, distance=-3, flip=True)  # on a face of the solid: a push now adds (the slab is already solid)
    assert volume(flipped.shape) == pytest.approx(BLOCK, rel=1e-6)
    assert Topology(load_demo("block")).face(top) is not None  # the face normal itself is untouched


def test_explicit_add_and_subtract_ignore_the_drag_direction():
    shape, face = TOP
    assert volume(run(shape, face, distance=-(GAP + 3), mode="add").shape) == pytest.approx(BLOCK + AREA * GAP, rel=1e-3)
    assert volume(run(shape, face, distance=4, mode="add").shape) == pytest.approx(BLOCK + AREA * 4, rel=1e-3)
    assert volume(run(shape, face, distance=-(GAP + 3), mode="subtract").shape) == pytest.approx(BLOCK - AREA * 3, rel=1e-3)
    with pytest.raises(OperationError, match="Nothing to subtract"):
        run(shape, face, distance=4, mode="subtract")


def test_explicit_modes_on_a_face_of_a_solid():
    block = load_demo("block")
    top = top_face(block)
    with pytest.raises(OperationError, match="Nothing to subtract"):
        run(block, top, distance=3, mode="subtract")
    assert volume(run(block, top, distance=-3, mode="subtract").shape) == pytest.approx(BLOCK - 1200 * 3, rel=1e-6)
    assert volume(run(block, top, distance=-3, mode="add").shape) == pytest.approx(BLOCK, rel=1e-6)
    assert volume(run(block, top, distance=3, mode="add").shape) == pytest.approx(BLOCK + 1200 * 3, rel=1e-6)


def test_a_new_body_is_never_merged_or_cut():
    shape, face = TOP
    for distance in (4, -(GAP + 3)):  # also when the prism overlaps the block
        result = run(shape, face, distance=distance, mode="new")
        assert len(solids_of(result.shape)) == 2
        assert volume(result.shape) == pytest.approx(BLOCK + AREA * abs(distance), rel=1e-3)
    block = load_demo("block")
    top = top_face(block)
    pulled = run(block, top, distance=3, mode="new")
    assert len(solids_of(pulled.shape)) == 2 and volume(pulled.shape) == pytest.approx(BLOCK + 1200 * 3, rel=1e-6)
    pushed = run(block, top, distance=-3, mode="new")  # the removed slab becomes a body, the original stays whole
    bodies = sorted(_vol(s) for s in solids_of(pushed.shape))
    assert len(bodies) == 2 and bodies[0] == pytest.approx(1200 * 3, rel=1e-6) and bodies[1] == pytest.approx(BLOCK, rel=1e-6)
    assert len(pushed.tracked_faces) == 1


def test_symmetric_adds_on_the_normal_side_and_cuts_on_the_other():
    shape, face = TOP
    auto = run(shape, face, distance=8, symmetric=True)
    assert volume(auto.shape) == pytest.approx(BLOCK - AREA * 3 + AREA * 8, rel=1e-3)
    flipped = run(shape, face, distance=8, symmetric=True, flip=True)
    assert volume(flipped.shape) == pytest.approx(BLOCK + AREA * GAP, rel=1e-3)  # the normal side cuts empty space, the other side adds
    both = run(shape, face, distance=8, symmetric=True, mode="add")
    assert volume(both.shape) == pytest.approx(BLOCK + AREA * 8 + AREA * GAP, rel=1e-3)
    new = run(shape, face, distance=8, symmetric=True, mode="new")
    assert len(solids_of(new.shape)) == 2 and volume(new.shape) == pytest.approx(BLOCK + AREA * 16, rel=1e-3)


def test_an_unknown_mode_is_refused():
    shape, face = TOP
    with pytest.raises(OperationError, match="mode"):
        run(shape, face, distance=4, mode="merge")


def top_face(shape) -> int:
    return next(i for i, f in Topology(shape).faces() if planar_normal(f) is not None and planar_normal(f).Z() > 0.99)


def preview(session, face, **params):
    reply = session.handle({"type": "tool_preview", "tool": "push_pull", "selection": {"faces": [face]}, "params": params})
    return decode_binary(reply)


def previewing(shape, face, **params):
    session = Session()
    session.document = Document(shape)
    return preview(session, face, **params)


def test_the_ghost_is_the_cutting_volume_outside_the_bodies():
    shape, face = TOP
    header, buffers = previewing(shape, face, distance=-(GAP + 3))
    assert header["ghost"]["triangles"] > 0
    zmin, zmax = header["ghost"]["bounds"][2], header["ghost"]["bounds"][5]
    assert (zmin, zmax) == pytest.approx((10.0, 15.0), abs=0.05)  # the 5 above the block; the 3 inside it are not in the ghost
    assert len(buffers["ghostIndices"]) == header["ghost"]["triangles"] * 3
    assert len(buffers["ghostPositions"]) == len(buffers["ghostNormals"]) > 0


def test_the_ghost_of_a_push_in_empty_space_is_the_whole_extrusion_and_the_note_comes_with_it():
    shape, face = TOP
    header, _ = previewing(shape, face, distance=-3)
    assert header["ghost"]["triangles"] > 0 and "Nothing to subtract" in header["notice"]


def test_there_is_no_ghost_unless_the_extrusion_subtracts_in_empty_space():
    shape, face = TOP
    for params in ({"distance": 4}, {"distance": -(GAP + 3), "mode": "add"}, {"distance": 4, "mode": "new"}, {"distance": 4, "flip": True, "mode": "add"}):
        header, buffers = previewing(shape, face, **params)
        assert "ghost" not in header and "ghostPositions" not in buffers
    block = load_demo("block")
    header, _ = previewing(block, top_face(block), distance=-3)  # a cut wholly inside the body leaves nothing outside it
    assert "ghost" not in header
    header, _ = previewing(block, top_face(block), distance=3)
    assert "ghost" not in header and "notice" not in header


def test_a_commit_carries_no_ghost():
    shape, face = TOP
    session = Session()
    session.document = Document(shape)
    reply = session.handle({"type": "tool_commit", "tool": "push_pull", "selection": {"faces": [face]}, "params": {"distance": -(GAP + 3)}})
    assert "ghost" not in decode_binary(reply)[0]

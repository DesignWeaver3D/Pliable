"""Mirror of a split body across the YZ plane: the kernel's face merge breaks the fused shape, so every face was left
split along the plane. The same-surface merge must join them through the Mirror tool's own path."""

from pathlib import Path

from OCP.BRep import BRep_Builder
from OCP.BRepTools import BRepTools
from OCP.TopoDS import TopoDS_Shape

from pliable.ops import solids_of
from pliable.topology import Topology
from pliable.tools import Selection, get_tool
from pliable.validity import is_valid

FIXTURE = Path(__file__).parent / "data" / "split_body.brep"  # the owner's model just before the mirror (29 faces)


def load() -> Topology:
    shape = TopoDS_Shape()
    assert BRepTools.Read_s(shape, str(FIXTURE), BRep_Builder())
    return Topology(shape)


def test_mirror_across_yz_merges_the_faces_split_along_the_plane():
    body = load()
    result = get_tool("mirror").execute(body, Selection(), {"plane": 3}, preview=False)  # YZ origin plane
    assert is_valid(result.shape)
    assert len(solids_of(result.shape)) == 1
    # 52 faces when nothing merged across the plane; 13 pairs of halves on one plane or cylinder join
    assert Topology(result.shape).face_count == 39

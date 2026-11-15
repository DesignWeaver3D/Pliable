"""The whole-model merge after an import runs in the background and changes nothing a request can see (bgmerge.py)."""

import base64

from OCP.BRep import BRep_Builder
from OCP.BRepAlgoAPI import BRepAlgoAPI_Cut, BRepAlgoAPI_Fuse
from OCP.BRepPrimAPI import BRepPrimAPI_MakeBox, BRepPrimAPI_MakeSphere
from OCP.TopoDS import TopoDS_Compound
from OCP.gp import gp_Ax2, gp_Dir, gp_Pnt

from pliable.files import write_step
from pliable.protocol import decode_binary
from pliable.server import Session

Z, Y = gp_Dir(0, 0, 1), gp_Dir(0, 1, 0)


def cavity_block(x):
    """A block with a spherical cavity whose halves were made apart (the merge joins them)."""
    low = BRepAlgoAPI_Cut(BRepPrimAPI_MakeBox(gp_Pnt(x, 0, 0), gp_Pnt(x + 20, 20, 4)).Shape(), BRepPrimAPI_MakeSphere(gp_Ax2(gp_Pnt(x + 10, 10, 4), Z), 3).Shape()).Shape()
    high = BRepAlgoAPI_Cut(BRepPrimAPI_MakeBox(gp_Pnt(x, 0, 4), gp_Pnt(x + 20, 20, 8)).Shape(), BRepPrimAPI_MakeSphere(gp_Ax2(gp_Pnt(x + 10, 10, 4), Z, Y), 3).Shape()).Shape()
    return BRepAlgoAPI_Fuse(low, high).Shape()


def model_file():
    compound, builder = TopoDS_Compound(), BRep_Builder()
    builder.MakeCompound(compound)
    for x in (0, 30, 60):
        builder.Add(compound, cavity_block(x))
    builder.Add(compound, BRepPrimAPI_MakeBox(gp_Pnt(100, 0, 0), gp_Pnt(110, 10, 10)).Shape())
    return base64.b64encode(write_step(compound)).decode()


def opened(data, wait_for_merge):
    session = Session()
    header = decode_binary(session.handle({"type": "import_step", "name": "x", "data": data}))[0]
    if wait_for_merge:
        session._import_merge._merge.wait()
    return session, header


def drag(session, header, dx):
    selection = {"faces": [], "edges": [], "vertices": [], "bodies": [header["bodies"][0]["id"]], "axes": []}
    params = {"dx": dx, "dy": 0, "dz": 0, "rx": 0, "ry": 0, "rz": 0}
    reply = session.handle({"type": "tool_preview", "tool": "move_body", "selection": selection, "params": params})
    return decode_binary(reply)[0]


def summary(header):
    return sorted((f["body"], f["count"]) for f in header["faces"]), len(header["edges"]), len(header["vertices"]), [b["name"] for b in header["bodies"]]


def test_the_background_merge_fills_the_memory_and_the_first_drag_gives_the_same_model():
    data = model_file()
    session, header = opened(data, wait_for_merge=True)
    topology = session.document.current
    assert set(topology.merge_memo) == {0, 1, 2, 3}  # every body, merged on its own
    after = drag(session, header, 5)
    plain, plain_header = opened(data, wait_for_merge=True)
    del plain.document.current.merge_memo
    assert summary(after) == summary(drag(plain, plain_header, 5))
    assert len(session.document.ids) == 1  # no undo step was made


def test_a_request_that_arrives_while_it_runs_waits_and_gets_the_whole_result():
    data = model_file()
    session, header = opened(data, wait_for_merge=False)  # the drag comes at once
    early = drag(session, header, 5)
    session._import_merge._merge.wait()
    assert getattr(session.document.current, "merge_memo", None) is not None
    assert summary(early) == summary(drag(session, header, 5))
    assert len(session.document.ids) == 1


def test_a_new_import_cancels_the_merge_of_the_old_model():
    data = model_file()
    session, _ = opened(data, wait_for_merge=False)
    first = session._import_merge._merge
    session.handle({"type": "import_step", "name": "y", "data": data})
    assert first._cancelled.is_set()
    session._import_merge._merge.wait()


def test_a_commit_that_leaves_the_model_unmerged_makes_the_merge_memory_in_the_background():
    data = model_file()
    session, header = opened(data, wait_for_merge=True)
    selection = {"faces": [], "edges": [], "vertices": [], "bodies": [header["bodies"][0]["id"]], "axes": []}
    params = {"dx": 5, "dy": 0, "dz": 0, "rx": 0, "ry": 0, "rz": 0}
    session.handle({"type": "tool_commit", "tool": "move_body", "selection": selection, "params": params})
    merge = session._import_merge._merge
    merge.wait()
    current = session.document.current
    assert merge.topology is current
    assert getattr(current, "merged", False) or getattr(current, "merge_memo", None) is not None

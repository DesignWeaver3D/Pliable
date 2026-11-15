"""A bore that removes whole bodies still takes the import merge's memory for the bodies it left alone, with the same result as merging the whole model."""

import base64

from OCP.BRep import BRep_Builder
from OCP.BRepPrimAPI import BRepPrimAPI_MakeBox
from OCP.TopoDS import TopoDS_Compound
from OCP.gp import gp_Pnt

import pliable.mergescope as mergescope
from pliable.files import write_step
from pliable.ops import solids_of
from pliable.protocol import decode_binary
from test_bgmerge import cavity_block, opened, summary


def model_file():
    compound, builder = TopoDS_Compound(), BRep_Builder()
    builder.MakeCompound(compound)
    builder.Add(compound, BRepPrimAPI_MakeBox(gp_Pnt(38, 8, -8), gp_Pnt(42, 12, -4)).Shape())  # first body: the bore removes all of it
    builder.Add(compound, cavity_block(30))  # cut by the bore
    builder.Add(compound, cavity_block(70))  # far away
    builder.Add(compound, BRepPrimAPI_MakeBox(gp_Pnt(100, 0, 0), gp_Pnt(110, 10, 10)).Shape())
    return base64.b64encode(write_step(compound)).decode()


def bore(session, header):
    body = header["bodies"][1]["id"]
    face = next(f for f in header["faces"] if f["body"] == body and f["normal"] is not None and f["normal"][2] > 0.9)
    request = {"type": "tool_commit", "tool": "add_hole", "selection": {"faces": [face["id"]]}, "params": {"diameter": 8, "depth": 0, "offset_u": 0}, "interact": "others"}
    return decode_binary(session.handle(request))[0]


def test_a_bore_that_removes_a_body_merges_only_the_changed_bodies_and_equals_the_whole_model_merge():
    data = model_file()
    seen = []
    real = mergescope.merge_faces
    mergescope.merge_faces = lambda result, *a, **k: (seen.append(len(solids_of(result.shape))), real(result, *a, **k))[1]
    try:
        scoped, header = opened(data, wait_for_merge=True)
        assert len(header["bodies"]) == 4
        seen.clear()
        with_memo = bore(scoped, header)
        assert len(with_memo["bodies"]) == 3  # the small block is gone
        assert seen and max(seen) < len(with_memo["bodies"])
        whole, header = opened(data, wait_for_merge=True)
        whole.document.current.merge_memo = None
        seen.clear()
        without = bore(whole, header)
        assert max(seen) == len(without["bodies"])
    finally:
        mergescope.merge_faces = real
    assert summary(with_memo) == summary(without)


def test_bodies_the_bore_did_not_touch_keep_their_ids_when_whole_bodies_are_removed():
    session, header = opened(model_file(), wait_for_merge=True)
    ids = {b["name"]: b["id"] for b in header["bodies"]}
    after = bore(session, header)
    kept = {b["id"] for b in after["bodies"]}
    assert ids[header["bodies"][2]["name"]] in kept and ids[header["bodies"][3]["name"]] in kept  # the two bodies the bore missed
    assert header["bodies"][0]["id"] not in kept  # the removed body is gone
    assert [b["id"] for b in after["bodies"]] == [header["bodies"][1]["id"], header["bodies"][2]["id"], header["bodies"][3]["id"]]

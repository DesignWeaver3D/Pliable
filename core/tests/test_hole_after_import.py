"""A hole cut right after an import takes the merge the background thread made of the other bodies, with the same result as merging the whole model."""

import pliable.mergescope as mergescope
from pliable.ops import solids_of
from pliable.protocol import decode_binary
from test_bgmerge import model_file, opened, summary


def hole(session, header):
    face = next(f for f in header["faces"] if f["body"] == header["bodies"][-1]["id"] and f["normal"] is not None and f["count"] > 0)
    request = {"type": "tool_commit", "tool": "add_hole", "selection": {"faces": [face["id"]]}, "params": {"diameter": 2, "depth": 3, "offset_u": 0}, "interact": "others"}
    return decode_binary(session.handle(request))[0]


def test_the_first_hole_after_an_import_merges_only_the_bodies_it_cut_and_equals_the_whole_model_merge():
    data = model_file()
    seen = []
    real = mergescope.merge_faces
    mergescope.merge_faces = lambda result, *a, **k: (seen.append(len(solids_of(result.shape))), real(result, *a, **k))[1]
    try:
        scoped, header = opened(data, wait_for_merge=True)
        assert scoped.document.current.merge_memo is not None
        seen.clear()
        with_memo = hole(scoped, header)
        assert seen and max(seen) < len(header["bodies"])  # the bodies the hole did not reach were taken from the memory
        whole, header = opened(data, wait_for_merge=True)
        whole.document.current.merge_memo = None
        seen.clear()
        without = hole(whole, header)
        assert max(seen) == len(header["bodies"])
    finally:
        mergescope.merge_faces = real
    assert summary(with_memo) == summary(without)

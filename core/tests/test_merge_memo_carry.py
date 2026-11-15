"""The merge memory carried over a commit gives the same models as a full merge of the whole model (mergememo.carry_memo)."""

from pliable.protocol import decode_binary
import pliable.handlers.tools as tools_handler

from test_bgmerge import model_file, opened


def sel(**kw):
    return {"faces": [], "edges": [], "vertices": [], "bodies": [], "axes": [], **kw}


def summary(header):
    bounds = [[round(v, 4) for v in b["bounds"]] for b in header["bodies"]]
    return sorted((f["body"], f["count"]) for f in header["faces"]), len(header["edges"]), len(header["vertices"]), [b["name"] for b in header["bodies"]], bounds


def run(carry, monkeypatch):
    if not carry:
        monkeypatch.setattr(tools_handler, "carry_memo", lambda before, after: None)
    session, header = opened(model_file(), wait_for_merge=True)
    z = {"dx": 0, "dy": 0, "dz": 0, "rx": 0, "ry": 0, "rz": 0}
    out, carried = [], []

    def commit(tool, selection, params):
        nonlocal header
        header = decode_binary(session.handle({"type": "tool_commit", "tool": tool, "selection": selection, "params": params}))[0]
        assert not header.get("error"), header.get("error")
        out.append(summary(header))
        carried.append(set(getattr(session.document.current, "merge_memo", None) or ()))

    def face_of(body):
        return next(f for f in header["faces"] if f["body"] == body and f["normal"] is not None and f["count"] > 0)["id"]

    ids = [b["id"] for b in header["bodies"]]
    commit("move_body", sel(bodies=[ids[0]]), {**z, "dx": 5})
    commit("move_body", sel(bodies=[ids[1]]), {**z, "dy": 4})
    commit("move_body", sel(bodies=[ids[0]]), {**z, "rz": 20})
    commit("push_pull", sel(faces=[face_of(ids[3])]), {"distance": 2})
    commit("move_body", sel(bodies=[ids[2]]), {**z, "dx": -3})
    commit("add_hole", sel(faces=[face_of(ids[3])]), {"diameter": 2, "depth": 0})
    commit("move_body", sel(bodies=[ids[0]]), {**z, "dz": 2})
    return out, carried


def test_the_carried_memory_gives_the_models_of_a_full_merge_over_several_commits(monkeypatch):
    with_memo, carried = run(True, monkeypatch)
    assert any(carried[i] for i in range(1, len(carried)))  # a later commit does hold the carried memory
    without, _ = run(False, monkeypatch)
    assert with_memo == without

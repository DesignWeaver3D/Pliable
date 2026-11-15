"""Delta replies (meshdelta.py): only the changed bodies travel, and the page's join gives the mesh a full reply gives."""

import numpy as np
from build123d import Box, Compound, Cylinder, Pos

from pliable.bodydisplay import body_ranges
from pliable.document import Document
from pliable.ops import solids_of
from pliable.protocol import decode_binary
from pliable.server import Session


class Page:
    """What the page does with replies (the join of `app/src/meshstore.ts`), in Python."""

    def __init__(self):
        self.held = {}
        self.version = None

    def apply(self, header):
        """Applies a delta header with its buffers already cut into per-body arrays (`cut`)."""
        delta = header["delta"]
        assert delta["base"] is None or delta["base"] == self.version, "base does not match what the page holds"
        held = {} if delta["base"] is None else self.held
        nxt = {}
        for b in delta["bodies"]:
            if "data" in b:
                nxt[b["id"]] = b
            else:
                assert b["id"] in held and held[b["id"]]["rev"] == b["rev"] and held[b["id"]]["faces"] == b["faces"]
                nxt[b["id"]] = held[b["id"]]
        self.held, self.version = nxt, delta["version"]

    def join(self, delta, buffers_of):
        pos, nor, idx, edg, faces, edges, vertices, centres = [], [], [], [], [], [], [], []
        pa = ia = ea = f0 = e0 = v0 = 0
        for solid, b in enumerate(delta["bodies"]):
            rec = self.held[b["id"]]
            data = rec["data"]
            p, n, i, e = (buffers_of[rec["id"]][name] for name in ("positions", "normals", "indices", "edgePositions"))
            pos.append(p)
            nor.append(n)
            idx.append(i + np.uint32(pa // 3))
            edg.append(e)
            faces += [{"id": f0 + k, "start": ia + f["start"], "count": f["count"], "normal": f["normal"], "centroid": f["centroid"], "solid": solid, "body": b["id"]} for k, f in enumerate(data["faces"])]
            edges += [{"id": e0 + k, "start": ea // 3 + x["start"], "count": x["count"], "normal": x["normal"], "solid": solid, "body": b["id"], "centre": x["centre"]} for k, x in enumerate(data["edges"])]
            vertices += [{"id": v0 + k, "position": v["position"], "solid": solid, "body": b["id"]} for k, v in enumerate(data["vertices"])]
            centres += [{"face": f0 + c["face"], "position": c["position"], "axis": c["axis"], "length": c["length"]} for c in data["centres"]]
            pa += p.size
            ia += i.size
            ea += e.size
            f0 += rec["faces"]
            e0 += rec["edges"]
            v0 += rec["vertices"]
        header = {"faces": faces, "edges": edges, "vertices": vertices, "centres": centres, "bodies": [b["info"] for b in delta["bodies"]]}
        cat = lambda a, t: np.concatenate(a) if a else np.empty(0, t)  # noqa: E731
        return header, {"positions": cat(pos, np.float32), "normals": cat(nor, np.float32), "indices": cat(idx, np.uint32), "edgePositions": cat(edg, np.float32)}


def blocks(n):
    return Compound([Pos(i * 30, 0, 0) * (Box(20, 20, 10) - Cylinder(3, 20)) for i in range(n)]).wrapped


def sel(**kw):
    return {"faces": [], "edges": [], "vertices": [], "bodies": [], "axes": [], **kw}


class Conn:
    def __init__(self, n=5, opt_in=True):
        self.session = Session()
        self.session.handle({"type": "hello", "deltaMesh": opt_in})
        self.session.document = Document(blocks(n), "t")
        self.page = Page()
        self.arrays = {}  # body id -> its four arrays, as the page keeps them
        self.last = None
        self.sizes = []

    def send(self, request):
        frame = self.session.handle(request)
        header, buffers = decode_binary(frame)
        self.sizes.append(len(frame))
        self.last = header
        assert "delta" in header
        self.page.apply(header)
        fresh = {}
        for b in header["delta"]["bodies"]:
            d = b.get("data")
            if d:
                fresh[b["id"]] = {name: buffers[name][d[name][0] : d[name][0] + d[name][1]] for name in ("positions", "normals", "indices", "edgePositions")}
        kept = {} if header["delta"]["base"] is None else self.arrays
        self.arrays = {b["id"]: fresh.get(b["id"], kept.get(b["id"])) for b in header["delta"]["bodies"]}
        return header

    def _join(self):
        return self.page.join(self.last["delta"], self.arrays)

    def check(self):
        mine, mybuf = self._join()
        frame = self.session.handle({"type": "full_mesh"})
        header, buffers = decode_binary(frame)
        assert "delta" not in header
        for name in ("faces", "edges", "vertices", "centres", "bodies"):
            assert mine[name] == header[name], name
        for name in ("positions", "normals", "indices", "edgePositions"):
            assert mybuf[name].tobytes() == buffers[name].tobytes(), name

    def changed(self):
        return [b["id"] for b in self.last["delta"]["bodies"] if "data" in b]

    def ids(self):
        return [b["id"] for b in self.last["delta"]["bodies"]]


def first(conn):
    return conn.send({"type": "full_mesh", "resync": True})


def test_a_connection_that_did_not_opt_in_gets_whole_replies():
    conn = Conn(opt_in=False)
    header, _ = decode_binary(conn.session.handle({"type": "full_mesh", "resync": True}))
    assert "delta" not in header and header["faces"]


def test_a_one_body_edit_sends_one_changed_body_and_joins_to_the_full_mesh():
    conn = Conn(6)
    first(conn)
    assert len(conn.changed()) == 6 and conn.last["delta"]["base"] is None
    conn.check()
    ids, full_size = conn.ids(), conn.sizes[-1]
    conn.send({"type": "tool_commit", "tool": "move_body", "selection": sel(bodies=[ids[2]]), "params": {"dx": 7, "rz": 90}})
    assert conn.changed() == [ids[2]] and conn.last["delta"]["base"] == 1
    assert conn.sizes[-1] < full_size / 3
    conn.check()
    face = next(f for f in conn._join()[0]["faces"] if f["body"] == ids[4] and f["normal"])["id"]
    conn.send({"type": "tool_commit", "tool": "push_pull", "selection": sel(faces=[face]), "params": {"distance": 2}})
    assert conn.changed() == [ids[4]]
    conn.check()


def test_deleting_an_early_body_renumbers_the_later_ones_without_resending_them():
    conn = Conn(5)
    first(conn)
    ids = conn.ids()
    before, _ = conn._join()
    last_face = max(f["id"] for f in before["faces"] if f["body"] == ids[4])
    conn.send({"type": "delete_body", "body": ids[1]})  # not an end body: the model keeps its size, so no body is meshed again
    assert conn.changed() == []
    assert conn.ids() == ids[:1] + ids[2:]
    mine, _ = conn._join()
    assert max(f["id"] for f in mine["faces"] if f["body"] == ids[4]) < last_face  # the later bodies are numbered again
    conn.check()


def test_undo_and_redo_give_the_bodies_back_by_revision():
    conn = Conn(4)
    first(conn)
    ids = conn.ids()
    conn.send({"type": "tool_commit", "tool": "move_body", "selection": sel(bodies=[ids[1]]), "params": {"dx": 5}})
    conn.send({"type": "undo"})
    assert conn.changed() == [ids[1]]  # the page held the moved one; the original comes back
    conn.check()
    conn.send({"type": "redo"})
    conn.check()
    conn.send({"type": "undo"})
    conn.send({"type": "delete_body", "body": ids[1]})
    conn.send({"type": "undo"})
    assert conn.changed() == [ids[1]]  # the page dropped the deleted body, so it is sent again; the others are held
    conn.check()


def test_a_fresh_model_holds_every_body_and_a_model_without_body_blocks_goes_whole():
    conn = Conn(3)
    first(conn)
    header, _ = decode_binary(conn.session.handle({"type": "new_project"}))
    assert "delta" not in header and conn.session.delta.sent is None  # no bodies: sent whole
    conn.session.document = Document(blocks(3), "t")
    conn.send({"type": "full_mesh", "resync": True})
    assert conn.last["delta"]["base"] is None and len(conn.changed()) == 3
    shared = Compound([Box(10, 10, 10), Pos(10, 0, 0) * Box(10, 10, 10)]).wrapped
    conn.session.document = Document(shared, "s")
    top = conn.session.document.current
    if body_ranges(top, solids_of(top.shape)) is None:
        header, _ = decode_binary(conn.session.handle({"type": "full_mesh", "resync": True}))
        assert "delta" not in header and conn.session.delta.sent is None

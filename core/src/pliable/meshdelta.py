"""Replies that carry only the bodies the page does not hold yet (the page side is `app/src/meshstore.ts`).

Face, edge and vertex ids stay global in the core. A delta reply lists every body in model order with its face, edge and
vertex counts and its entry of the `bodies` list; the display data (the four buffers and the per-face, per-edge, per-vertex
and per-centre records, numbered from the body's own first one) travels only for the bodies whose revision (`BodyData.rev`)
differs from the one last sent on this connection. The page rebuilds the same mesh a full reply gives, numbering from the
counts. A connection takes deltas only after it asked for them in `hello`; a model whose ids are not one block per body
(`Mesh.parts` is None) is sent whole, and then nothing is held on the page.
"""

import numpy as np

from .protocol import encode_binary
from .tessellate import Mesh

# Request types that give the page a model of its own: its reply is a delta with no base, every body carrying its data.
FRESH = frozenset({"open_demo", "new_project", "import_step", "resume_session", "restore_session", "open_project"})


class DeltaState:
    """What this connection's page holds: the revision of each body of the last delta reply."""

    def __init__(self):
        self.enabled = False
        self.version = 0
        self.sent: dict[int, int] | None = None  # body id -> revision; None when the page holds nothing

    def reset(self, enabled: bool | None = None):
        self.sent = None
        if enabled is not None:
            self.enabled = enabled


def _record(part, spans) -> dict:
    data = part.data
    return {
        "positions": spans["positions"], "normals": spans["normals"], "indices": spans["indices"], "edgePositions": spans["edgePositions"],
        "faces": [{"start": s, "count": c, "normal": None if n is None else list(n), "centroid": g} for s, c, n, g in data.faces],
        "edges": [{"start": s, "count": c, "normal": None if n is None else list(n), "centre": None if m is None else list(m)} for s, c, n, m in data.edges],
        "vertices": [{"position": v["position"]} for v in part.vertices],
        "centres": [{"face": f, "position": list(p), "axis": list(a), "length": ln} for f, p, a, ln in data.centres],
    }


def encode_delta(state: DeltaState, header: dict, mesh: Mesh, extra_buffers: dict | None, fresh: bool) -> bytes | None:
    """The delta frame for `mesh`, or None when it has to be sent whole (the caller then resets the state)."""
    parts = mesh.parts
    if parts is None or any(p.body is None or p.info is None for p in parts) or len({p.body for p in parts}) != len(parts):
        return None
    base = None if fresh or state.sent is None else state.version
    held = {} if base is None else state.sent
    chunks: dict[str, list] = {"positions": [], "normals": [], "indices": [], "edgePositions": []}
    sizes = dict.fromkeys(chunks, 0)
    bodies, now = [], {}
    for part in parts:
        data = part.data
        have = held.get(part.body)
        if have is not None and data.full_rev and have == data.full_rev:
            rev = have  # a preview of a body the page holds in full: the full display shows all the preview does
        else:
            rev = data.rev
        now[part.body] = rev
        entry = {"id": part.body, "rev": rev, "faces": part.span[1], "edges": part.span[3], "vertices": part.span[5], "info": part.info}
        if have != rev:
            arrays = {"positions": data.positions, "normals": data.normals, "indices": data.indices, "edgePositions": data.edge_positions}
            spans = {}
            for name, array in arrays.items():
                spans[name] = [sizes[name], array.size]  # in elements of the shared buffer
                chunks[name].append(array)
                sizes[name] += array.size
            entry["data"] = _record(part, spans)
        bodies.append(entry)
    state.version += 1
    state.sent = now
    buffers = {
        "positions": np.concatenate(chunks["positions"]).astype(np.float32, copy=False) if chunks["positions"] else np.empty(0, np.float32),
        "normals": np.concatenate(chunks["normals"]).astype(np.float32, copy=False) if chunks["normals"] else np.empty(0, np.float32),
        "indices": np.concatenate(chunks["indices"]).astype(np.uint32, copy=False) if chunks["indices"] else np.empty(0, np.uint32),
        "edgePositions": np.concatenate(chunks["edgePositions"]).astype(np.float32, copy=False) if chunks["edgePositions"] else np.empty(0, np.float32),
        **(extra_buffers or {}),
    }
    return encode_binary({**header, "delta": {"version": state.version, "base": base, "bodies": bodies}, "bounds": mesh.bounds}, buffers)

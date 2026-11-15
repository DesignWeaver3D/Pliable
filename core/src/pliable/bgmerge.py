"""The whole-model merge after an import, done in the background so the first drag does not have to wait for it.

The first move of an imported model merges every body (seconds on a model of many bodies) and keeps the merged form of
the bodies that did not move (`mergememo.py`), so the next previews merge the moved body only. Here that same memory is
made right after the import, one body at a time on a thread of its own, from the bodies the import gave: when the bodies
share nothing, the merge of the whole is the merge of each body (see mergememo.py). A request that would use the model
waits for the thread, so it never sees a half-made memory; a request that only reads waits for nothing, and a request that
replaces the model cancels the thread. The model and its undo history are not touched: only `topology.merge_memo` is set,
once, after the last body. The merged bodies are meshed there too, as the display would on the first drag.
"""

import logging
import threading
import time

from . import meshing
from .bodydisplay import body_ranges
from .mergememo import BOX_TOLERANCE, _box, _same_place
from .ops import OpResult, is_surface, solids_of
from .samesurface import _compound_of
from .shared.solids import finish
from .tessellate import ANGULAR_DEFLECTION, linear_deflection
from .topology import Topology

log = logging.getLogger("pliable.bgmerge")

PAUSE_SECONDS = 0.01  # between two bodies, so a query that arrived meanwhile gets the interpreter

# Requests that only read the model or leave it alone: they do not wait for the merge.
READS = frozenset({
    "hello", "list_tools", "available_tools", "hole_selection", "tool_handles", "measure", "related", "face_frame", "edge_chain",
    "edge_faces", "edge_selection", "model_info", "diagnostics", "usage_event", "notice_get", "notice_ack", "usage_clear",
    "sketch_plane", "sketch_solve", "sketch_flip", "sketch_freedom", "sketch_offset", "sketch_profiles", "sketch_get",
})
# Requests that replace the open model: the merge of the old one is of no use.
REPLACES = frozenset({"import_step", "open_demo", "new_project", "open_project", "resume_session", "restore_session"})


class BackgroundMerge:
    def __init__(self, topology: Topology):
        self.topology = topology
        self._cancelled = threading.Event()
        self._done = threading.Event()
        self._thread = threading.Thread(target=self._run, daemon=True, name="import-merge")

    def start(self) -> None:
        self._thread.start()

    def cancel(self) -> None:
        self._cancelled.set()

    def wait(self) -> None:
        self._done.wait()

    def _run(self) -> None:
        try:
            self._merge_bodies()
        except Exception:
            log.exception("background merge failed")  # the first move merges the whole model as it always did
        finally:
            self._done.set()

    def _merge_bodies(self) -> None:
        topology = self.topology
        solids = solids_of(topology.shape)
        if len(solids) < 2 or body_ranges(topology, solids) is None:
            return
        deflection = linear_deflection(topology.shape)
        outs = []
        for solid in solids:
            if self._cancelled.is_set():
                return
            made = solids_of(finish(_compound_of([solid])).shape)
            if len(made) != 1 or is_surface(made[0]) != is_surface(solid):
                return
            meshing.mesh(made[0], deflection, ANGULAR_DEFLECTION)  # the faces the merge made are meshed here, not by the first drag's reply
            outs.append(made[0])
            time.sleep(PAUSE_SECONDS)
        diagonal = max((abs(a - b) for a, b in zip(_box(topology.shape)[3:], _box(topology.shape)[:3])), default=1.0) or 1.0
        topology.merge_memo = {i: (solids[i], outs[i]) for i in range(len(solids)) if _same_place(solids[i], outs[i], diagonal * BOX_TOLERANCE)}


class ImportMerge:
    """What a session keeps of the merge after an import: ask for it, start it once the reply is built, and arrange for requests."""

    def __init__(self):
        self._asked = False
        self._merge: BackgroundMerge | None = None

    def ask(self) -> None:
        self._asked = True

    def before(self, kind) -> None:
        """Called before a request is handled."""
        merge = self._merge
        if merge is None or kind in READS:
            return
        if kind in REPLACES:
            merge.cancel()
            self._merge = None
        else:
            merge.wait()

    def after(self, document) -> None:
        """Called after a request is answered: start the merge that was asked for, on the model now open."""
        asked, self._asked = self._asked, False
        if asked and document is not None:
            if self._merge is not None:
                self._merge.cancel()
            self._merge = BackgroundMerge(document.current)
            self._merge.start()

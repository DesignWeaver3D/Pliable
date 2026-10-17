"""Crash protection: the open model and its undo steps, saved as native BREP.

After every change the session hands its document to `Autosaver.save`. New
states are written on a background thread (one file per state, named by its
id) together with a small `session.json` that records the order and the
current position. Files of states that fell out of the history are removed.
The folder is kept after a clean exit too, so a model closed by mistake can
be restored. `session.json` has `"clean": true` once the server shut down
normally; a missing flag on the next launch means the core was killed.
"""

import json
import logging
import os
import sys
import threading
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from OCP.BRep import BRep_Builder
from OCP.BRepTools import BRepTools
from OCP.TopoDS import TopoDS_Shape

from .document import Document

log = logging.getLogger("pliable.autosave")


def data_folder() -> Path:
    override = os.environ.get("PLIABLE_DATA")
    if override:
        return Path(override)
    if sys.platform == "win32":
        base = Path(os.environ.get("LOCALAPPDATA") or Path.home() / "AppData" / "Local")
    elif sys.platform == "darwin":
        base = Path.home() / "Library" / "Application Support"
    else:
        base = Path(os.environ.get("XDG_DATA_HOME") or Path.home() / ".local" / "share")
    return base / "Pliable"


def _write_brep(shape: TopoDS_Shape, path: Path) -> None:
    temp = path.with_suffix(".tmp")
    if not BRepTools.Write_s(shape, str(temp)):
        raise OSError(f"could not write {temp}")
    os.replace(temp, path)


def _read_brep(path: Path) -> TopoDS_Shape:
    shape = TopoDS_Shape()
    if not BRepTools.Read_s(shape, str(path), BRep_Builder()):
        raise OSError(f"could not read {path}")
    return shape


class Autosaver:
    def __init__(self, folder: Path | None = None):
        self.folder = (folder or data_folder()) / "autosave"
        self._pool = ThreadPoolExecutor(max_workers=1, thread_name_prefix="autosave")
        self._written: set[int] = set()
        self._lock = threading.Lock()

    @property
    def _meta_path(self) -> Path:
        return self.folder / "session.json"

    def _state_path(self, state_id: int) -> Path:
        return self.folder / f"state_{state_id}.brep"

    def save(self, document: Document, fresh: bool = False) -> None:
        """Queue a snapshot of the document. Shapes are immutable once committed, so the worker may read them.

        `fresh` marks a newly opened document, whose state ids restart at 0 and must overwrite old files."""
        ids = document.ids
        with self._lock:
            new = {i: document.shape_of(i) for i in ids if fresh or i not in self._written}
        meta = {"name": document.name, "ids": ids, "index": document.index, "clean": False}
        self._pool.submit(self._write, new, meta)

    def _write(self, new: dict[int, TopoDS_Shape], meta: dict) -> None:
        try:
            self.folder.mkdir(parents=True, exist_ok=True)
            for state_id, shape in new.items():
                _write_brep(shape, self._state_path(state_id))
            self._write_meta(meta)
            keep = set(meta["ids"])
            for path in self.folder.glob("state_*.brep"):
                if int(path.stem.split("_")[1]) not in keep:
                    path.unlink(missing_ok=True)
            with self._lock:
                self._written = keep
        except Exception:
            log.exception("autosave failed")  # never take the session down over a backup

    def _write_meta(self, meta: dict) -> None:
        temp = self._meta_path.with_suffix(".tmp")
        temp.write_text(json.dumps(meta))
        os.replace(temp, self._meta_path)

    def flush(self) -> None:
        self._pool.submit(lambda: None).result()

    def mark_clean(self) -> None:
        """Record a normal shutdown (keeps the saved model)."""
        self.flush()
        try:
            meta = json.loads(self._meta_path.read_text())
            meta["clean"] = True
            self._write_meta(meta)
        except (OSError, ValueError):
            pass

    def available(self) -> dict | None:
        """What a restore would bring back, or None: `{name, steps, clean}`."""
        try:
            meta = json.loads(self._meta_path.read_text())
            if not all(self._state_path(i).exists() for i in meta["ids"]):
                return None
            return {"name": meta["name"], "steps": len(meta["ids"]), "clean": bool(meta.get("clean"))}
        except (OSError, ValueError, KeyError):
            return None

    def restore(self) -> Document | None:
        try:
            meta = json.loads(self._meta_path.read_text())
            shapes = [_read_brep(self._state_path(i)) for i in meta["ids"]]
            document = Document.from_states(shapes, meta["ids"], int(meta["index"]), meta["name"])
        except (OSError, ValueError, KeyError, IndexError):
            log.exception("restore failed")
            return None
        with self._lock:
            self._written = set(meta["ids"])
        return document

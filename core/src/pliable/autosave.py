"""Crash protection: the open model and its undo steps, saved as native BREP.

Every running instance owns one subfolder `autosave/inst_<id>/` and keeps a
`lock.json` there fresh (a heartbeat touches it every few seconds). A subfolder
whose lock is gone, whose process has exited or whose heartbeat is old belongs
to a dead instance: only those are offered for restore, most recent first, and
at most `MAX_OLD_SESSIONS` of them are kept. `session.json` carries a `format`
number; sessions written by a newer format are never offered or deleted.

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
import shutil
import sys
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from OCP.BRep import BRep_Builder
from OCP.BRepTools import BRepTools
from OCP.TopoDS import TopoDS_Shape

from .document import Document

log = logging.getLogger("pliable.autosave")

FORMAT = 1  # version of the session.json layout; bump when an older release could not read it
MAX_OLD_SESSIONS = 5  # dead instances' sessions kept for restore
HEARTBEAT_SECONDS = 5.0
STALE_AFTER_SECONDS = 30.0


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


def _pid_alive(pid: int) -> bool:
    if pid <= 0:
        return False
    if sys.platform == "win32":
        import ctypes

        kernel = ctypes.windll.kernel32
        kernel.OpenProcess.restype = ctypes.c_void_p
        kernel.GetExitCodeProcess.argtypes = [ctypes.c_void_p, ctypes.c_void_p]
        kernel.CloseHandle.argtypes = [ctypes.c_void_p]
        handle = kernel.OpenProcess(0x1000, False, pid)  # PROCESS_QUERY_LIMITED_INFORMATION
        if not handle:
            return False
        code = ctypes.c_ulong()
        ok = kernel.GetExitCodeProcess(handle, ctypes.byref(code))
        kernel.CloseHandle(handle)
        return bool(ok) and code.value == 259  # STILL_ACTIVE
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return True


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
    def __init__(self, folder: Path | None = None, heartbeat: float = HEARTBEAT_SECONDS,
                 stale_after: float = STALE_AFTER_SECONDS, max_old: int = MAX_OLD_SESSIONS):
        self.root = (folder or data_folder()) / "autosave"
        self.stale_after = stale_after
        self.max_old = max_old
        self.folder = self.root / f"inst_{int(time.time())}_{uuid.uuid4().hex[:8]}"
        self._pool = ThreadPoolExecutor(max_workers=1, thread_name_prefix="autosave")
        self._written: set[int] = set()
        self._lock = threading.Lock()
        self._offered: Path | None = None
        self._stop = threading.Event()
        self._adopt_legacy()
        self._take_lock()
        threading.Thread(target=self._beat, args=(heartbeat,), daemon=True, name="autosave-heartbeat").start()

    # --- ownership -------------------------------------------------------

    @property
    def _lock_path(self) -> Path:
        return self.folder / "lock.json"

    def _take_lock(self) -> None:
        try:
            self.folder.mkdir(parents=True, exist_ok=True)
            self._lock_path.write_text(json.dumps({"pid": os.getpid(), "format": FORMAT}))
        except OSError:
            log.exception("could not create the autosave folder")

    def _beat(self, interval: float) -> None:
        while not self._stop.wait(interval):
            try:
                if self._lock_path.exists():
                    os.utime(self._lock_path)
                else:
                    self._take_lock()
            except OSError:
                pass

    def _adopt_legacy(self) -> None:
        """Files from before per-instance folders sit directly in the root; move them aside as an old session."""
        if not (self.root / "session.json").exists():
            return
        target = self.root / f"inst_legacy_{uuid.uuid4().hex[:8]}"
        try:
            target.mkdir(parents=True)
            for path in list(self.root.glob("session.json")) + list(self.root.glob("state_*.brep")):
                os.replace(path, target / path.name)
        except OSError:
            pass  # another instance is doing the same

    @staticmethod
    def _is_live(folder: Path, stale_after: float) -> bool:
        lock = folder / "lock.json"
        try:
            info = json.loads(lock.read_text())
            age = time.time() - lock.stat().st_mtime
            return age < stale_after and _pid_alive(int(info.get("pid", 0)))
        except (OSError, ValueError, TypeError):
            return False

    @staticmethod
    def _read_meta(folder: Path) -> dict | None:
        try:
            meta = json.loads((folder / "session.json").read_text())
            if int(meta.get("format", 0)) > FORMAT:
                return None  # written by a newer release
            if not all((folder / f"state_{i}.brep").exists() for i in meta["ids"]):
                return None
            return meta
        except (OSError, ValueError, KeyError, TypeError):
            return None

    def _dead_sessions(self) -> list[tuple[float, Path, dict]]:
        """Offerable sessions of instances that are gone, most recent first."""
        found = []
        for folder in self.root.glob("inst_*"):
            if folder == self.folder or not folder.is_dir() or self._is_live(folder, self.stale_after):
                continue
            meta = self._read_meta(folder)
            if meta is not None:
                try:
                    found.append(((folder / "session.json").stat().st_mtime, folder, meta))
                except OSError:
                    pass
        found.sort(key=lambda item: item[0], reverse=True)
        return found

    def _prune(self) -> None:
        """Delete dead sessions beyond the cap, empty dead folders and leftovers of claimed ones."""
        try:
            for folder in self.root.glob("claimed_*"):  # left behind by a crash during restore; skip fresh ones
                if time.time() - int(folder.name.split("_")[1]) > 300:
                    shutil.rmtree(folder, ignore_errors=True)
            for folder in self.root.glob("inst_*"):
                if folder != self.folder and folder.is_dir() and not (folder / "session.json").exists() \
                        and not self._is_live(folder, self.stale_after):
                    shutil.rmtree(folder, ignore_errors=True)
            for _, folder, _ in self._dead_sessions()[self.max_old:]:
                shutil.rmtree(folder, ignore_errors=True)
        except OSError:
            log.exception("autosave cleanup failed")

    # --- writing ---------------------------------------------------------

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
        meta = {"format": FORMAT, "name": document.name, "ids": ids, "index": document.index, "clean": False}
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
        """Record a normal shutdown (keeps the saved model) and give up the lock."""
        self.flush()
        self._stop.set()
        try:
            if self._meta_path.exists():
                meta = json.loads(self._meta_path.read_text())
                meta["clean"] = True
                self._write_meta(meta)
            else:
                shutil.rmtree(self.folder, ignore_errors=True)
            self._lock_path.unlink(missing_ok=True)
        except (OSError, ValueError):
            pass
        self._prune()

    # --- restoring -------------------------------------------------------

    def available(self, unclean_only: bool = False) -> dict | None:
        """The newest session of a dead instance, or None: `{name, steps, clean}`.

        With `unclean_only`, sessions closed normally are skipped. The one returned is the one `restore` brings back."""
        self._prune()
        for _, folder, meta in self._dead_sessions():
            clean = bool(meta.get("clean"))
            if unclean_only and clean:
                continue
            self._offered = folder
            return {"name": meta["name"], "steps": len(meta["ids"]), "clean": clean}
        self._offered = None
        return None

    def restore(self) -> Document | None:
        """Bring back the offered session (else the newest) and consume it, so it is offered once."""
        if self._offered is None:
            self.available()
        source, self._offered = self._offered, None
        if source is None:
            return None
        claimed = self.root / f"claimed_{int(time.time())}_{uuid.uuid4().hex[:8]}"
        try:
            os.rename(source, claimed)  # atomic: only one instance can claim a session
        except OSError:
            return None
        try:
            meta = json.loads((claimed / "session.json").read_text())
            shapes = [_read_brep(claimed / f"state_{i}.brep") for i in meta["ids"]]
            document = Document.from_states(shapes, meta["ids"], int(meta["index"]), meta["name"])
        except (OSError, ValueError, KeyError, IndexError):
            log.exception("restore failed")
            return None
        finally:
            shutil.rmtree(claimed, ignore_errors=True)
        with self._lock:
            self._written = set()  # nothing of it is in our own folder yet; the caller saves with fresh=True
        return document

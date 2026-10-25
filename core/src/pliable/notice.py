"""The alpha notice acknowledgement, kept once per user.

It lives in the shared per-user data folder (not an instance's autosave
subfolder), so it covers every release and browser on the machine. Bump
`NOTICE_EPOCH` only when the risks change materially: everyone then sees the
notice again.
"""

import json
import os
import uuid
from pathlib import Path

from .autosave import data_folder

NOTICE_EPOCH = 1


def _path() -> Path:
    return data_folder() / "notice.json"


def acknowledged() -> bool:
    try:
        return int(json.loads(_path().read_text()).get("epoch", 0)) >= NOTICE_EPOCH
    except (OSError, ValueError, TypeError, AttributeError):
        return False


def acknowledge() -> None:
    """Record the acknowledgement. Written through a unique temp file and a rename, so two instances cannot corrupt it."""
    path = _path()
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_name(f"notice.{os.getpid()}.{uuid.uuid4().hex[:8]}.tmp")
    temp.write_text(json.dumps({"epoch": NOTICE_EPOCH}))
    os.replace(temp, path)

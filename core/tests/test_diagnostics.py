import json
import logging

import pytest

from pliable import diagnostics
from pliable.ops import OperationError
from pliable.server import Session


def test_scrub_reduces_paths_to_base_names():
    assert diagnostics.scrub(r"failed on C:\Users\someone\models\part.step now") == "failed on part.step now"
    assert diagnostics.scrub("read /home/someone/models/part.step") == "read part.step"


def test_report_has_versions_log_and_last_tool():
    diagnostics.install()
    logging.getLogger("pliable.test").warning(r"opened C:\Users\someone\secret\thing.step")
    session = Session()
    session.handle({"type": "open_demo", "name": "bracket"})
    session.handle({"type": "tool_commit", "tool": "push_pull", "selection": {"faces": [0]}, "params": {"distance": 1}})
    report = session.handle({"type": "diagnostics"})["report"]
    assert report["pliable"] and report["opencascade"] and report["python"]
    assert report["lastTool"]["tool"] == "push_pull" and report["lastTool"]["ok"]
    text = json.dumps(report)
    assert "thing.step" in text and "secret" not in text


def test_failed_tool_is_recorded_with_error():
    session = Session()
    session.handle({"type": "open_demo", "name": "bracket"})
    with pytest.raises(Exception):
        session.handle({"type": "tool_commit", "tool": "push_pull", "selection": {"faces": [9999]}, "params": {"distance": 1}})
    last = session.handle({"type": "diagnostics"})["report"]["lastTool"]
    assert last["ok"] is False and last["error"]


def test_import_reply_reports_solid_count():
    import base64
    from build123d import Box, Pos
    from pliable.files import write_step
    from pliable.protocol import decode_binary

    shape = (Box(10, 10, 10) + Pos(20, 0, 0) * Box(5, 5, 5)).wrapped
    session = Session()
    reply = session.handle({"type": "import_step", "name": "two", "data": base64.b64encode(write_step(shape)).decode()})
    assert decode_binary(reply)[0]["solids"] == 2


def test_usage_counts_appear_in_the_report_and_clear():
    session = Session()
    for event, surface in [("start", "strip"), ("start", "search"), ("start", "bogus"), ("commit", None), ("cancel", None), ("error", None)]:
        session.handle({"type": "usage_event", "tool": "push_pull", "event": event, "surface": surface})
    row = session.handle({"type": "diagnostics"})["report"]["usage"]["push_pull"]
    assert (row["start"], row["commit"], row["cancel"], row["error"]) == (3, 1, 1, 1)
    assert row["surfaces"] == {"strip": 1, "search": 1, "other": 1}
    session.handle({"type": "usage_clear"})
    assert session.handle({"type": "diagnostics"})["report"]["usage"] == {}


def test_usage_ignores_bad_names():
    session = Session()
    session.handle({"type": "usage_event", "tool": "../etc/passwd", "event": "start"})
    session.handle({"type": "usage_event", "tool": "push_pull", "event": "dance"})
    session.handle({"type": "usage_event", "tool": 5, "event": "start"})
    assert session.handle({"type": "diagnostics"})["report"]["usage"] == {}


def test_version_is_the_same_everywhere():
    import re
    import tomllib
    from pathlib import Path

    from pliable import __version__

    root = Path(__file__).resolve().parents[2]
    assert tomllib.loads((root / "core" / "pyproject.toml").read_text(encoding="utf8"))["project"]["version"] == __version__
    cargo = tomllib.loads((root / "desktop" / "src-tauri" / "Cargo.toml").read_text(encoding="utf8"))
    assert cargo["package"]["version"] == __version__
    conf = json.loads((root / "desktop" / "src-tauri" / "tauri.conf.json").read_text(encoding="utf8"))
    assert conf["version"] == __version__
    assert re.fullmatch(r"\d+\.\d+\.\d+", __version__)


def test_report_describes_the_installation():
    report = Session().handle({"type": "diagnostics"})["report"]
    assert report["machine"] and report["uptimeSeconds"] >= 0 and isinstance(report["packaged"], bool)
    session = Session()
    session.handle({"type": "open_demo", "name": "bracket"})
    assert session.handle({"type": "diagnostics"})["report"]["model"]["bodies"] >= 1

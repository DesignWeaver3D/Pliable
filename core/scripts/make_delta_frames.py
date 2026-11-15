"""Writes app/tests/fixtures/delta_frames.json: real frames from the core for the page's tests of delta replies.

Run from core/: uv run python scripts/make_delta_frames.py
Frames (base64): the first reply of a delta connection (every body), a one-body move, a delete of a middle body, an undo,
and a whole frame of the model after the undo (what the page's join must equal).
"""

import base64
import json
from pathlib import Path

from build123d import Box, Compound, Cylinder, Pos

from pliable.document import Document
from pliable.server import Session

OUT = Path(__file__).resolve().parents[2] / "app" / "tests" / "fixtures" / "delta_frames.json"
sel = lambda **kw: {"faces": [], "edges": [], "vertices": [], "bodies": [], "axes": [], **kw}  # noqa: E731

session = Session()
session.handle({"type": "hello", "deltaMesh": True})
session.document = Document(Compound([Pos(i * 30, 0, 0) * (Box(20, 20, 10) - Cylinder(3, 20)) for i in range(4)]).wrapped, "t")
frames = {}
frames["first"] = session.handle({"type": "full_mesh", "resync": True})
ids = [1, 2, 3, 4]
ids = [b.id for b in session.document.current.bodies.bodies]
params = {"dx": 7, "dy": 0, "dz": 0, "rx": 0, "ry": 0, "rz": 0}
frames["move"] = session.handle({"type": "tool_commit", "tool": "move_body", "selection": sel(bodies=[ids[2]]), "params": params})
frames["delete"] = session.handle({"type": "delete_body", "body": ids[1]})
frames["undo"] = session.handle({"type": "undo"})
frames["whole"] = session.handle({"type": "full_mesh"})
OUT.parent.mkdir(parents=True, exist_ok=True)
OUT.write_text(json.dumps({k: base64.b64encode(v).decode() for k, v in frames.items()}, indent=1))
print("wrote", OUT, {k: len(v) for k, v in frames.items()})

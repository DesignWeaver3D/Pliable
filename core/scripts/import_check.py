"""Headless import check: load a STEP file into the core and time import, mesh, model info, push/pull, undo, export and re-import. Usage: uv run python scripts/import_check.py FILE.step (read-only on the input)."""
import json, sys, time, traceback

from OCP.BRepAdaptor import BRepAdaptor_Surface
from OCP.GeomAbs import GeomAbs_Plane
from pliable.document import Document
from pliable.files import read_step, write_step
from pliable.measure import model_info
from pliable.tessellate import tessellate
from pliable.tools import Selection, get_tool
from pliable.topology import Topology

out = {}
def step(name, fn):
    t = time.perf_counter()
    try:
        r = fn()
        out[name] = {"ok": True, "s": round(time.perf_counter() - t, 2), **(r or {})}
        return r
    except Exception as e:
        out[name] = {"ok": False, "s": round(time.perf_counter() - t, 2), "error": f"{type(e).__name__}: {str(e)[:200]}"}
        return None

path = sys.argv[1]
data = open(path, "rb").read()
state = {}
def imp():
    state["shape"] = read_step(data)
    state["doc"] = Document(state["shape"], "t")
    top = state["doc"].current
    return {"faces": top.face_count, "edges": top.edge_count}
step("import", imp)
if "doc" in state:
    top = state["doc"].current
    def mesh():
        m = tessellate(top)
        return {"triangles": int(len(m.indices) // 3) if hasattr(m, "indices") else None}
    step("tessellate", mesh)
    def info():
        rows = model_info(top)
        return {"raw": str(rows)[:600]}
    step("model_info", info)
    def pp():
        face = next(i for i in range(top.face_count) if BRepAdaptor_Surface(top.face(i)).GetType() == GeomAbs_Plane)
        tool = get_tool("push_pull")
        res = tool.execute(top, Selection(faces=[face]), {"distance": 1.0}, preview=False)
        state["doc"].commit(res.shape)
        return {"face": face, "newFaces": state["doc"].current.face_count}
    step("push_pull", pp)
    step("undo", lambda: {"undone": state["doc"].undo(), "faces": state["doc"].current.face_count})
    def exp():
        b = write_step(state["doc"].current.shape)
        state["out"] = b
        return {"bytes": len(b)}
    step("export_step", exp)
    def reimp():
        s = read_step(state["out"])
        return {"faces": Topology(s).face_count}
    step("reimport", reimp)
print(json.dumps(out))

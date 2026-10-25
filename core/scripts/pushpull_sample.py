"""Sample push/pull on ~12 evenly spaced planar faces (both directions) of a STEP file and report how many succeed. Usage: uv run python scripts/pushpull_sample.py FILE.step (read-only on the input)."""
import json, sys, time
from OCP.BRepAdaptor import BRepAdaptor_Surface
from OCP.GeomAbs import GeomAbs_Plane
from pliable.files import read_step_checked
from pliable.tools import Selection, get_tool
from pliable.topology import Topology
top = Topology(read_step_checked(open(sys.argv[1], "rb").read())[0])
planar = [i for i in range(top.face_count) if BRepAdaptor_Surface(top.face(i)).GetType() == GeomAbs_Plane]
sample = planar[:: max(1, len(planar) // 12)][:12]
tool = get_tool("push_pull"); res = []
for f in sample:
    for d in (1.0, -1.0):
        t = time.perf_counter()
        try:
            tool.execute(top, Selection(faces=[f]), {"distance": d}, preview=False); ok = "ok"
        except Exception as e:
            ok = f"{type(e).__name__}"
        res.append((f, d, ok, round(time.perf_counter() - t, 2)))
print(json.dumps({"planar": len(planar), "ok": sum(r[2] == "ok" for r in res), "tried": len(res), "slowest": max(r[3] for r in res), "fails": [r[:3] for r in res if r[2] != "ok"][:6]}))

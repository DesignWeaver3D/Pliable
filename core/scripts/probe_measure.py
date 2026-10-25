from pliable.demos import load_demo
from pliable.measure import measure
from pliable.tools import Selection
from pliable.topology import Topology

t = Topology(load_demo("bracket"))
fmt = lambda v: "vec" if isinstance(v, list) else round(v, 2)
for i, _ in t.faces():
    m = measure(t, Selection(faces=[i]))["items"][0]
    print("F", i, m["title"], [(r["label"], fmt(r["value"])) for r in m["rows"][:4]])
for i, _ in list(t.edges())[:12]:
    m = measure(t, Selection(edges=[i]))["items"][0]
    print("E", i, m["title"], [(r["label"], fmt(r["value"])) for r in m["rows"][:3]])

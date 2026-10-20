"""Time one Push/Pull on one body of a model with many bodies.

Usage: uv run python scripts/bench_bodies.py [--sizes 1 50 150 400] [--no-cache]

For each size, builds a compound of N blocks (each with a hole), then times a
drag preview and a commit of a Push/Pull on one top face through
Session.handle, with a stage breakdown of the last commit. Repeats a few times
and reports the last run, which shows the steady
state, where the display cache holds the unchanged bodies.
"""

import argparse
import time
from collections import defaultdict

from build123d import Box, Compound, Cylinder, Pos

from pliable import bodies as body_ids
from pliable import ops, protocol, recipes, server, tessellate, topology
from pliable.document import Document
from pliable.ops import planar_normal
from pliable.server import Session

totals = defaultdict(float)


def timed(label, fn):
    def wrapper(*a, **k):
        t = time.perf_counter()
        try:
            return fn(*a, **k)
        finally:
            totals[label] += (time.perf_counter() - t) * 1000

    return wrapper


body_ids.carry = timed("bodies.carry", body_ids.carry)
recipes.settle = timed("recipes.settle", recipes.settle)
tessellate.tessellate = server.tessellate = timed("tessellate", tessellate.tessellate)
topology.Topology.__init__ = timed("topology index", topology.Topology.__init__)
ops.push_pull = timed("push_pull op", ops.push_pull)
protocol.encode_mesh = server.encode_mesh = timed("encode_mesh", protocol.encode_mesh)
Session._autosave = timed("autosave", Session._autosave)


def model(n):
    side = int(n**0.5) + 1
    parts = [Pos((i % side) * 30, (i // side) * 30, 0) * (Box(20, 20, 10) - Cylinder(3, 20)) for i in range(n)]
    return Compound(parts).wrapped


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--sizes", type=int, nargs="+", default=[1, 50, 150, 400])
    parser.add_argument("--no-cache", action="store_true", help="clear the display cache before every request")
    args = parser.parse_args()

    for n in args.sizes:
        session = Session()
        session.document = Document(model(n), "bench")
        face_id = next(i for i, f in session.document.current.faces() if (v := planar_normal(f)) is not None and v.Z() > 0.999)
        tessellate.display_cache.clear()
        runs = 2 if n >= 400 else 3
        previews, commits = [], []
        for _ in range(runs):
            for commit, out in ((False, previews), (True, commits)):
                if args.no_cache:
                    tessellate.display_cache.clear()
                totals.clear()
                request = {"type": "tool_commit" if commit else "tool_preview", "tool": "push_pull", "selection": {"faces": [face_id]}, "params": {"distance": 3.0}}
                t = time.perf_counter()
                session.handle(request)
                out.append((time.perf_counter() - t) * 1000)
                if commit:
                    stages = ", ".join(f"{k} {v:.0f}" for k, v in sorted(totals.items(), key=lambda kv: -kv[1]))
            session.handle({"type": "undo"})
        print(f"N={n:4d}  preview {previews[-1]:6.0f} ms  commit {commits[-1]:6.0f} ms  (last commit stages, ms: {stages})")


if __name__ == "__main__":
    main()

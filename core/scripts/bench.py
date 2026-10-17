"""Headless push/pull timing on the demo models.

Usage: uv run python scripts/bench.py [--steps N]

For each demo, pushes the top face by a series of distances (both
directions), the way a drag would, and reports operation, tessellation,
and encoding times.
"""

import argparse
import statistics
import time

from pliable.demos import DEMOS, load_demo
from pliable.ops import planar_normal, push_pull
from pliable.protocol import encode_mesh
from pliable.tessellate import tessellate
from pliable.topology import Topology


def top_face(topology: Topology) -> int:
    return max((n.Z(), i) for i, f in topology.faces() if (n := planar_normal(f)) is not None)[1]


def summarize(values: list[float]) -> str:
    values = sorted(values)
    p95 = values[min(len(values) - 1, round(0.95 * (len(values) - 1)))]
    return f"median {statistics.median(values):7.1f}  p95 {p95:7.1f}"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--steps", type=int, default=20)
    args = parser.parse_args()

    for name in DEMOS:
        start = time.perf_counter()
        topology = Topology(load_demo(name))
        build_ms = (time.perf_counter() - start) * 1000
        initial = tessellate(topology)
        face = topology.face(top_face(topology))
        op_ms, mesh_ms, encode_ms, sizes, commit_ms = [], [], [], [], []
        for step in range(1, args.steps + 1):
            distance = (step / args.steps) * 5 * (1 if step % 2 else -1)
            t0 = time.perf_counter()
            result = push_pull(topology.shape, face, distance, preview=True)
            t1 = time.perf_counter()
            mesh = tessellate(Topology(result.shape))
            t2 = time.perf_counter()
            frame = encode_mesh({"kind": "mesh"}, mesh)
            t3 = time.perf_counter()
            op_ms.append((t1 - t0) * 1000)
            mesh_ms.append((t2 - t1) * 1000)
            encode_ms.append((t3 - t2) * 1000)
            sizes.append(len(frame))
            if step % 4 == 0:
                t4 = time.perf_counter()
                push_pull(topology.shape, face, distance)
                commit_ms.append((time.perf_counter() - t4) * 1000)
        total = [a + b + c for a, b, c in zip(op_ms, mesh_ms, encode_ms)]
        print(
            f"{name}: {topology.face_count} faces, {initial.indices.size // 3} triangles, "
            f"built in {build_ms:.0f} ms, frame ~{statistics.median(sizes) / 1024:.0f} KiB"
        )
        print(f"  op      {summarize(op_ms)} ms")
        print(f"  mesh    {summarize(mesh_ms)} ms")
        print(f"  encode  {summarize(encode_ms)} ms")
        print(f"  total   {summarize(total)} ms  (preview: op + mesh + encode)")
        print(f"  commit  {summarize(commit_ms)} ms  (exact boolean, op only)")


if __name__ == "__main__":
    main()

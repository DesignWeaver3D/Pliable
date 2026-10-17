"""End-to-end drag latency over the real WebSocket server.

Usage: uv run python scripts/latency.py [--steps N]   (server must be running)

For each demo, opens it, then sends preview_push_pull requests one at a time
for the top face (as the UI does while dragging) and times send -> full
binary mesh received. Then times a commit and an undo.
"""

import argparse
import asyncio
import json
import statistics
import time

import websockets

from pliable.demos import DEMOS, load_demo
from pliable.ops import planar_normal
from pliable.protocol import decode_binary
from pliable.topology import Topology


async def call(ws, rid, type_, **params):
    start = time.perf_counter()
    await ws.send(json.dumps({"id": rid, "type": type_, **params}))
    reply = json.loads(await ws.recv())
    if reply.get("binary"):
        frame = await ws.recv()
        reply = decode_binary(frame)[0]
    return (time.perf_counter() - start) * 1000, reply


async def main(steps: int):
    for name in DEMOS:
        topology = Topology(load_demo(name))
        top = max((n.Z(), i) for i, f in topology.faces() if (n := planar_normal(f)) is not None)[1]
        async with websockets.connect("ws://127.0.0.1:8765", max_size=None) as ws:
            open_ms, header = await call(ws, 1, "open_demo", name=name)
            times = []
            for i in range(1, steps + 1):
                distance = (i / steps) * 5 * (1 if i % 2 else -1)
                ms, _ = await call(ws, 100 + i, "tool_preview", tool="push_pull", selection={"faces": [top]}, params={"distance": distance})
                times.append(ms)
            commit_ms, _ = await call(ws, 900, "tool_commit", tool="push_pull", selection={"faces": [top]}, params={"distance": 2.0})
            undo_ms, _ = await call(ws, 901, "undo")
        times.sort()
        p95 = times[min(len(times) - 1, round(0.95 * (len(times) - 1)))]
        print(
            f"{name:18s} open {open_ms:6.0f} ms | preview median {statistics.median(times):6.0f} "
            f"p95 {p95:6.0f} ms | commit {commit_ms:6.0f} ms | undo {undo_ms:5.0f} ms"
        )


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--steps", type=int, default=12)
    asyncio.run(main(parser.parse_args().steps))

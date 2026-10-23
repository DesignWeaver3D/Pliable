"""The registered tools, in order, with everything the client sees. Guards the file split (docs/architecture-plan.md):
moving a tool to another file must not change which tools exist, their order or their declared shape.

To accept a deliberate change, regenerate the golden file: `uv run python tests/test_tool_registry.py`."""

import json
from dataclasses import asdict
from pathlib import Path

import pliable.server  # noqa: F401  (loads every module that registers tools)
from pliable.tools import TOOLS

GOLDEN = Path(__file__).parent / "tool_registry.json"


def snapshot() -> list[dict]:
    return [
        {
            "id": t.id,
            "label": t.label,
            "description": t.description,
            "accepts": asdict(t.accepts),
            "params": [asdict(p) for p in t.params],
            "related": list(t.related),
            "placement": t.placement,
            "move_vector": t.move_vector,
            "starts_from": t.starts_from,
            "hidden": t.hidden,
            "whole_model_needs_one_body": t.whole_model_needs_one_body,
            "body_kind": t.body_kind,
            "keeps_body_order": t.keeps_body_order,
        }
        for t in TOOLS.values()
    ]


def test_registry_matches_the_golden_file():
    golden = json.loads(GOLDEN.read_text(encoding="utf-8"))
    current = json.loads(json.dumps(snapshot()))
    assert [t["id"] for t in current] == [t["id"] for t in golden], "tool ids or their order changed"
    for now, then in zip(current, golden):
        assert now == then, now["id"]


if __name__ == "__main__":
    GOLDEN.write_text(json.dumps(snapshot(), indent=1) + "\n", encoding="utf-8")
    print(f"wrote {len(TOOLS)} tools to {GOLDEN}")

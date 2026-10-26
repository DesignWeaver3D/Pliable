"""Lists which tools use each top-level helper (docs/archive/architecture-plan.md, Phase 0, item 5).

Prints a markdown table of helpers defined in the files that hold tools, with the tools and other
helpers that reference them; helpers used by two or more tools belong in shared/. Usage: python scripts/helper_usage.py"""

import ast
import sys
from collections import defaultdict
from pathlib import Path

PACKAGE = Path(__file__).resolve().parent.parent / "core" / "src" / "pliable"
FILES = ["features.py", "tools.py", "holes.py", "hole_tools.py", "stretch.py"]


def is_tool(node: ast.AST) -> bool:
    return isinstance(node, ast.ClassDef) and any(
        isinstance(d, ast.Name) and d.id == "register" for d in node.decorator_list
    )


def main() -> None:
    defs: dict[str, tuple[str, ast.AST]] = {}
    for name in FILES:
        for node in ast.parse((PACKAGE / name).read_text(encoding="utf-8-sig")).body:
            if isinstance(node, (ast.FunctionDef, ast.ClassDef)):
                defs[node.name] = (name, node)  # a later duplicate replaces the earlier, as at import time
    users: dict[str, set[str]] = defaultdict(set)
    for name, (_, node) in defs.items():
        for ref in ast.walk(node):
            if isinstance(ref, ast.Name) and ref.id in defs and ref.id != name:
                users[ref.id].add(name)
    print("| helper | file | tools using it | other helpers using it |")
    print("|---|---|---|---|")
    for name, (file, node) in sorted(defs.items(), key=lambda kv: (kv[1][0], kv[0])):
        if is_tool(node):
            continue
        tools = sorted(u for u in users[name] if is_tool(defs[u][1]))
        helpers = sorted(u for u in users[name] if not is_tool(defs[u][1]))
        print(f"| {name} | {file} | {', '.join(tools) or '-'} | {', '.join(helpers) or '-'} |")


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main()

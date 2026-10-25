"""Proves a code move was pure (docs/architecture-plan.md, Phase 0).

Hashes every top-level function, and every method under ".name", in core/src/pliable (docstrings included, comments and import lines
not), keyed by name without the module path, so a def that moved to another
file hashes the same.

  python scripts/check_moves.py save [file]     write the hashes (default scripts/move_baseline.json)
  python scripts/check_moves.py check [file]    compare the current tree with them; exit 1 on any difference
  python scripts/check_moves.py dupes           list top-level names defined more than once

Set PLIABLE_PACKAGE to hash another copy of the package (for example one extracted from a tag).
Relative import statements inside function bodies are ignored (their paths change when code moves).

Known, deliberate differences go in IGNORED below with the reason."""

import ast
import os
import hashlib
import json
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PACKAGE = Path(os.environ.get("PLIABLE_PACKAGE") or ROOT / "core" / "src" / "pliable")
DEFAULT = Path(__file__).with_name("move_baseline.json")

# name -> why the hash may differ or vanish. The first `_faces_of` in features.py is dead code (a later
# definition replaces it), and the plan drops it.
IGNORED = {"_faces_of": "defined twice in features.py; only the later (raw shape) version is live"}


class _Imports(ast.NodeTransformer):
    """Drops function-local relative imports; where they point changes when code moves."""

    def visit_ImportFrom(self, node):
        return None if node.level else node


def definitions() -> dict[str, list[tuple[str, str]]]:
    """name -> [(file, hash of the normalized tree)] for every top-level def and class."""
    found: dict[str, list[tuple[str, str]]] = defaultdict(list)
    for path in sorted(PACKAGE.rglob("*.py")):
        tree = ast.parse(path.read_text(encoding="utf-8-sig"))
        where = str(path.relative_to(PACKAGE)).replace("\\", "/")

        def add(name: str, node: ast.AST) -> None:
            digest = hashlib.sha256(ast.dump(_Imports().visit(node), include_attributes=False).encode()).hexdigest()[:16]
            found[name].append((where, digest))

        for node in tree.body:
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                add(node.name, node)
            elif isinstance(node, ast.ClassDef):
                # Methods are hashed on their own, under ".name", so a method can move to another class (a mixin);
                # the class itself is hashed without them and without its bases, and not at all when nothing else is left.
                methods = [m for m in node.body if isinstance(m, (ast.FunctionDef, ast.AsyncFunctionDef))]
                rest = [m for m in node.body if m not in methods and not (isinstance(m, ast.Expr) and isinstance(m.value, ast.Constant))]
                for m in methods:
                    add("." + m.name, m)
                if rest:
                    add(node.name, ast.ClassDef(name=node.name, bases=[], keywords=[], body=rest, decorator_list=node.decorator_list, type_params=[]))
    return found


def hashes() -> dict[str, list[str]]:
    return {name: sorted(h for _, h in entries) for name, entries in definitions().items()}


def main(argv: list[str]) -> int:
    action = argv[1] if len(argv) > 1 else "check"
    target = Path(argv[2]) if len(argv) > 2 else DEFAULT
    if action == "save":
        target.write_text(json.dumps(hashes(), indent=1, sort_keys=True) + "\n", encoding="utf-8")
        print(f"saved {len(hashes())} names to {target}")
        return 0
    if action == "dupes":
        for name, entries in sorted(definitions().items()):
            if len(entries) > 1:
                print(name, "->", ", ".join(f"{f}" + ("" if len({h for _, h in entries}) > 1 else " (same)") for f, _ in entries))
        return 0
    before = json.loads(target.read_text(encoding="utf-8"))
    after = hashes()
    problems = []
    for name in sorted(set(before) | set(after)):
        if name in IGNORED:
            continue
        if name not in after:
            problems.append(f"missing: {name}")
        elif name not in before:
            problems.append(f"new: {name}")
        elif before[name] != after[name]:
            problems.append(f"changed: {name}")
    if problems:
        print("\n".join(problems))
        return 1
    print(f"{len(after)} names unchanged")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))

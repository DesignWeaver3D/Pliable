"""Prints what each source file is for, from the first sentence of its header comment, so a file is found by its job
without opening it.

  python scripts/module_map.py              every file of the app and the core
  python scripts/module_map.py sketch dim   only the lines that contain every given word (file name or job)

The text comes straight from the files, so it cannot go stale. A file listed as "(no header)" needs a first-line comment
saying its one job.
"""

import ast
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def first_sentence(text: str) -> str:
    text = " ".join(text.split())
    end = re.search(r"(?<=[a-z0-9)`])[.:] (?=[A-Z`])", text)
    return text[: end.start() + 1] if end else text


def ts_job(path: Path) -> str:
    lines = path.read_text(encoding="utf-8-sig", errors="replace")[:6000].split("\n")
    while lines and (not lines[0].strip() or lines[0].startswith(("import ", "export * from", "export {"))):
        lines.pop(0)  # a header written under the imports still counts
    head = "\n".join(lines).lstrip()
    block = re.match(r"/\*\*?(.*?)\*/", head, re.S)
    if block:
        return first_sentence(re.sub(r"^\s*\* ?", "", block.group(1), flags=re.M))
    line = re.match(r"((?://.*\n)+)", head)
    return first_sentence(re.sub(r"^// ?", "", line.group(1), flags=re.M)) if line else ""


def py_job(path: Path) -> str:
    try:
        doc = ast.get_docstring(ast.parse(path.read_text(encoding="utf-8-sig")))
    except SyntaxError:
        doc = None
    return first_sentence(doc.split("\n\n")[0]) if doc else ""


def main(words: list[str]) -> int:
    rows = []
    for path in sorted((ROOT / "app" / "src").rglob("*.ts")):
        rows.append((path, ts_job(path)))
    for path in sorted((ROOT / "core" / "src" / "pliable").rglob("*.py")):
        if path.name != "__init__.py" or path.stat().st_size > 200:
            rows.append((path, py_job(path)))
    for path, job in rows:
        line = f"{path.relative_to(ROOT).as_posix()}: {job or '(no header)'}"
        if all(w.lower() in line.lower() for w in words):
            print(line[:300])
    return 0


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.exit(main(sys.argv[1:]))

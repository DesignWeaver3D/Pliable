"""Block other products' names from the files of this repository.

Documentation and code must describe behavior in our own words and must not name
other programs, AI tools or vendors (see CONTRIBUTING.md). Reference notes live in
docs/research, which is local only and ignored by git.

  check_content.py --staged   check lines added in the staged changes (pre-commit hook)
  check_content.py --all      check every tracked text file (CI)
"""
import argparse
import re
import subprocess
import sys

from check_commit_message import NAMES

SKIP = (
    "LICENSE", "scripts/check_commit_message.py", "scripts/check_content.py",
    "THIRD_PARTY_NOTICES.md", ".gitignore", ".gitattributes",
)
SKIP_SUFFIX = (".lock", "package-lock.json", ".png", ".ico", ".jpg", ".svg", ".woff", ".woff2")


def git(*args):
    return subprocess.run(["git", *args], capture_output=True, text=True, encoding="utf-8",
                          errors="replace", check=True).stdout


def skipped(path):
    return path in SKIP or path.endswith(SKIP_SUFFIX) or path.startswith("docs/research/")


def hits(text):
    return [m.group(0) for rx in NAMES for m in [rx.search(text)] if m]


def main():
    ap = argparse.ArgumentParser()
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--staged", action="store_true")
    g.add_argument("--all", action="store_true")
    a = ap.parse_args()
    problems = []
    if a.staged:
        path = None
        for line in git("diff", "--cached", "-U0", "--no-color").splitlines():
            if line.startswith("+++ "):
                path = line[6:] if line.startswith("+++ b/") else None
            elif path and not skipped(path) and line.startswith("+") and not line.startswith("+++"):
                found = hits(line[1:])
                if found:
                    problems.append(f"{path}: {', '.join(found)}: {line[1:].strip()[:80]}")
    else:
        for path in git("ls-files").splitlines():
            if skipped(path):
                continue
            try:
                text = open(path, encoding="utf-8").read()
            except (UnicodeDecodeError, OSError):
                continue
            for n, line in enumerate(text.splitlines(), 1):
                found = hits(line)
                if found:
                    problems.append(f"{path}:{n}: {', '.join(found)}")
    if problems:
        print("Other products' names found (describe the behavior instead; reference notes go in docs/research, which is not tracked):")
        print(*problems, sep="\n  ")
        sys.exit(1)


main()

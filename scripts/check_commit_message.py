"""Check commit messages against the project's rules.

Used by .githooks/commit-msg (one message file) and by the commit-lint workflow
(a range of commits). Exits 1 and prints the problems if any message breaks a rule.

Rules:
- No commercial product names (other CAD programs, AI tools and vendors) and no
  attribution lines. Describe behaviour instead of naming the product.
- Subject: 12 to 72 characters, starts with a capital letter, no trailing period,
  no label prefixes such as "S22:", "feat:", "Progress:" or "WIP".
- Commits that touch 3 or more files need a body that says what changed and why.
- Body lines are at most 80 characters, with a blank line after the subject.
"""
import argparse
import re
import subprocess
import sys

BANNED = [
    re.compile(p, re.I) for p in (
        r"\bplasticity\b", r"\bspace ?claim\b", r"\bsolidworks\b", r"\bfusion ?360\b",
        r"\bonshape\b", r"\brhino(ceros)?\b", r"\btinkercad\b", r"\bfreecad\b",
        r"\bansys\b", r"\bsiemens\b", r"\bparasolid\b", r"\bsketchup\b", r"\bautocad\b",
        r"\bcatia\b", r"\bnx cad\b", r"\bcreo\b", r"\binventor\b", r"\bzbrush\b",
        r"\bclaude\b", r"\banthropic\b", r"\bchatgpt\b", r"\bopenai\b", r"\bgemini\b",
        r"\bcopilot\b", r"co-authored-by", r"generated (with|by)",
    )
] + [re.compile(r"\bSolid Edge\b")]  # case-sensitive: "solid edge" is also plain geometry

PREFIX = re.compile(r"^(S\d+[a-z]?\b|feat\b|fix\b|chore\b|docs\b|wip\b|progress\b|research\b)\s*[:\-]", re.I)
BODY_FILES = 3
BODY_WIDTH = 80


def check(message, files_changed=None):
    lines = [l for l in message.splitlines() if not l.startswith("#")]
    while lines and not lines[-1].strip():
        lines.pop()
    if not lines:
        return ["empty message"]
    subject, rest = lines[0], lines[1:]
    problems = []
    if subject.startswith("Merge "):
        return problems
    for rx in BANNED:
        m = rx.search(message)
        if m:
            problems.append(f"names a product or tool ('{m.group(0)}'); describe the behaviour instead")
    if not 12 <= len(subject) <= 72:
        problems.append(f"subject is {len(subject)} characters; use 12 to 72")
    if not subject[:1].isupper():
        problems.append("subject must start with a capital letter")
    if subject.endswith("."):
        problems.append("subject must not end with a period")
    if PREFIX.match(subject):
        problems.append("subject must not start with a label such as 'S22:', 'feat:' or 'Progress:'")
    if any(ord(c) > 0x2000 for c in message):
        problems.append("no emoji or special symbols")
    if rest and rest[0].strip():
        problems.append("leave a blank line after the subject")
    body = [l for l in rest if l.strip()]
    if files_changed is not None and files_changed >= BODY_FILES and sum(len(l) for l in body) < 40:
        problems.append(f"{files_changed} files changed: add a body saying what changed and why")
    for l in body:
        if len(l) > BODY_WIDTH:
            problems.append(f"body line over {BODY_WIDTH} characters: '{l[:30]}...'")
            break
    return problems


def git(*args):
    return subprocess.run(["git", *args], capture_output=True, text=True, check=True).stdout


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--file", help="commit message file (commit-msg hook); staged files are counted")
    ap.add_argument("--range", help="revision range to check, e.g. origin/main..HEAD")
    a = ap.parse_args()
    failed = False
    if a.file:
        msg = open(a.file, encoding="utf-8").read()
        staged = len([f for f in git("diff", "--cached", "--name-only").splitlines() if f])
        found = check(msg, staged)
        if found:
            failed = True
            print("Commit message rejected:", *found, sep="\n  - ")
    if a.range:
        for sha in git("rev-list", "--reverse", a.range).split():
            msg = git("log", "-1", "--format=%B", sha)
            n = len([f for f in git("diff-tree", "--no-commit-id", "--name-only", "-r", sha).splitlines() if f])
            found = check(msg, n)
            if found:
                failed = True
                print(f"{sha[:7]} {msg.splitlines()[0]}", *found, sep="\n  - ")
    sys.exit(1 if failed else 0)


main()

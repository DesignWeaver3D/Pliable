"""Prompts for a split discussion when a staged source file is long.

Never blocks a commit. Prints a note for each staged source file over the
threshold, so the person or agent committing raises it with the owner and adds a
planned row to docs/progress.md instead of growing the file silently.
"""
import subprocess
import sys

THRESHOLD = 400
SUFFIXES = (".py", ".ts")


def staged_files():
    out = subprocess.run(
        ["git", "diff", "--cached", "--name-only", "--diff-filter=AM"],
        capture_output=True, text=True, check=True,
    ).stdout
    return [f for f in out.splitlines() if f.endswith(SUFFIXES)]


def staged_lines(path):
    blob = subprocess.run(["git", "show", ":" + path], capture_output=True)
    return blob.stdout.count(b"\n") if blob.returncode == 0 else 0


def main():
    long_files = [(staged_lines(f), f) for f in staged_files()]
    long_files = [(n, f) for n, f in long_files if n > THRESHOLD]
    for n, f in sorted(long_files, reverse=True):
        print(f"note: {f} has {n} lines (over about {THRESHOLD}). Evaluate whether it "
              "does more than one job; if so, raise a split with the owner and add "
              "a Planned row to docs/progress.md.", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())

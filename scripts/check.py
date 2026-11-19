"""Run the checks a change needs before it is pushed: only the test suites for the files that changed.
The pre-push hook runs this; CI runs the same suites on every system, so a pass here is a pass on this computer only.
Usage: python scripts/check.py [--all] [--base REF] [--list]"""
import argparse
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BASES = ("upstream/main", "origin/main", "main")

# Which folders each suite covers. The scripts have their tests in the core suite.
SUITE_PATHS: dict[str, tuple[str, ...]] = {
    "core": ("core/", "scripts/", "build.sh", "build.bat"),
    "app": ("app/",),
    "shell": ("desktop/",),
}
ALWAYS = ("rules",)
ORDER = ("rules", "app", "shell", "core")


def suites_for(paths: list[str]) -> list[str]:
    """The suites to run for these changed files, quickest first. The rule checks always run."""
    wanted = set(ALWAYS)
    for suite, prefixes in SUITE_PATHS.items():
        if any(path.startswith(prefixes) for path in paths):
            wanted.add(suite)
    return [suite for suite in ORDER if suite in wanted]


def commands_for(suite: str, base: str) -> list[tuple[list[str], str]]:
    """The commands of one suite, each with the folder (under the repository root) it runs in."""
    python = sys.executable
    table: dict[str, list[tuple[list[str], str]]] = {
        "rules": [
            ([python, "scripts/check_content.py", "--all"], "."),
            ([python, "scripts/check_commit_message.py", "--range", f"{base}..HEAD"], "."),
            ([python, "scripts/check_release_docs.py"], "."),
        ],
        "core": [(["uv", "run", "pytest", "-q"], "core")],
        "app": [(["npm", "test"], "app"), (["npx", "tsc", "--noEmit"], "app")],
        "shell": [(["cargo", "test", "--locked"], "desktop/src-tauri")],
    }
    return table[suite]


def git_lines(*args: str) -> list[str]:
    """The non-empty output lines of a git command run in the repository."""
    out = subprocess.run(["git", *args], cwd=ROOT, check=True, capture_output=True, text=True).stdout
    return [line for line in out.splitlines() if line]


def find_base(asked: str | None) -> str:
    """The branch to compare with: the one asked for, or the first usual one that exists."""
    for ref in ([asked] if asked else BASES):
        if subprocess.run(["git", "rev-parse", "--verify", "--quiet", ref], cwd=ROOT, capture_output=True).returncode == 0:
            return ref
    sys.exit(f"check: no branch to compare with (tried {asked or ', '.join(BASES)}); pass --base REF")


def changed_paths(base: str) -> list[str]:
    """Files that differ from the base branch: committed on this branch, changed in the working tree, or new."""
    committed = git_lines("diff", "--name-only", f"{base}...HEAD")
    working = git_lines("diff", "--name-only", "HEAD")
    untracked = git_lines("ls-files", "--others", "--exclude-standard")
    return sorted({*committed, *working, *untracked})


def run(command: list[str], folder: str) -> bool:
    """Run one command and say whether it passed. A missing program stops everything with its name."""
    program = shutil.which(command[0])
    if program is None:
        sys.exit(f"check: `{command[0]}` is not installed or not on the PATH")
    print(f"\n== {' '.join(command)}  (in {folder})", flush=True)
    return subprocess.run([program, *command[1:]], cwd=ROOT / folder).returncode == 0


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--all", action="store_true", help="run every suite, whatever changed")
    parser.add_argument("--base", help="branch to compare with (default: the first of " + ", ".join(BASES) + ")")
    parser.add_argument("--list", action="store_true", help="print the suites that would run, and stop")
    args = parser.parse_args()
    base = find_base(args.base)
    suites = list(ORDER) if args.all else suites_for(changed_paths(base))
    print(f"check: comparing with {base}; suites: {', '.join(suites)}")
    if args.list:
        return
    failed = [" ".join(command) for suite in suites for command, folder in commands_for(suite, base) if not run(command, folder)]
    if failed:
        sys.exit("\ncheck: FAILED\n  " + "\n  ".join(failed))
    print("\ncheck: all passed")


if __name__ == "__main__":
    main()

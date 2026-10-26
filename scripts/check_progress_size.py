"""Blocks a commit that stages docs/progress.md over the size limit.

progress.md holds open work only; owner items go to docs/author-guidance.md
and finished work lives in commit messages. Trim the file before committing.
"""
import subprocess
import sys

LIMIT = 48 * 1024
PATH = "docs/progress.md"


def main():
    blob = subprocess.run(["git", "show", ":" + PATH], capture_output=True)
    if blob.returncode != 0:
        return 0
    size = len(blob.stdout)
    if size > LIMIT:
        print(f"error: {PATH} is {size // 1024} KB (limit {LIMIT // 1024} KB). Delete finished "
              "rows, move owner items to docs/author-guidance.md, and trim ideas "
              "that are built or rejected.", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())

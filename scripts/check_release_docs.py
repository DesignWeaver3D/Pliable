"""Check that the documents a release ships are ready before it is tagged or built.

Usage: python scripts/check_release_docs.py [TAG]     (TAG such as v0.4.0 is checked against the version number)

Checks:
- the version is the same in the core, its project file, the desktop shell and its settings;
- the tag, when given, is that version with a leading v;
- the README names the current version;
- the release notes and known limitations exist;
- the third-party notices were reviewed against the current dependency lock files (a fingerprint of each lock
  file is kept in THIRD_PARTY_NOTICES.md; when a lock file changes, review the list, then run
  `python scripts/check_release_docs.py --update-fingerprints`).
Exit code 1 and a list of problems when anything is wrong."""
import hashlib, json, re, sys, tomllib
from pathlib import Path

root = Path(__file__).resolve().parents[1]
LOCKS = ["desktop/src-tauri/Cargo.lock", "core/uv.lock", "app/package-lock.json", "desktop/package-lock.json"]
MARKER = re.compile(r"<!-- lock fingerprints: (.*?) -->")


def text(path: str) -> str:
    return (root / path).read_text(encoding="utf8").replace("\r\n", "\n")


def fingerprint(path: str) -> str:
    data = text(path)
    # our own packages change version on every release; that alone does not need a review of the notices
    data = re.sub(r'(name = "pliable(?:-desktop)?"\nversion = )"[^"]*"', r'\1""', data)
    data = re.sub(r'("name": "pliable-(?:app|desktop)",\n\s*"version": )"[^"]*"', r'\1""', data)
    return hashlib.sha256(data.encode()).hexdigest()[:12]


def fingerprints() -> str:
    return " ".join(f"{p}={fingerprint(p)}" for p in LOCKS)


def versions() -> dict[str, str]:
    init = re.search(r'__version__ = "([^"]+)"', text("core/src/pliable/__init__.py"))
    return {
        "core/src/pliable/__init__.py": init.group(1) if init else "?",
        "core/pyproject.toml": tomllib.loads(text("core/pyproject.toml"))["project"]["version"],
        "desktop/src-tauri/Cargo.toml": tomllib.loads(text("desktop/src-tauri/Cargo.toml"))["package"]["version"],
        "desktop/src-tauri/tauri.conf.json": json.loads(text("desktop/src-tauri/tauri.conf.json"))["version"],
    }


def problems(tag: str | None) -> list[str]:
    found = []
    seen = versions()
    version = seen["core/src/pliable/__init__.py"]
    if len(set(seen.values())) > 1:
        found.append(f"the version differs between files: {seen}")
    if tag and tag != f"v{version}":
        found.append(f"the tag {tag} does not match the version {version} (expected v{version})")
    if f"v{version}" not in text("README.md"):
        found.append(f"README.md does not mention v{version}; update its status line")
    for doc in ("docs/release-notes.md", "docs/known-limitations.md"):
        if not (root / doc).is_file():
            found.append(f"{doc} is missing")
    marker = MARKER.search(text("THIRD_PARTY_NOTICES.md"))
    if not marker:
        found.append("THIRD_PARTY_NOTICES.md has no lock fingerprint line; run with --update-fingerprints")
    elif marker.group(1) != fingerprints():
        found.append("a dependency lock file changed since THIRD_PARTY_NOTICES.md was reviewed: check the list "
                     "(new libraries, licenses), then run `python scripts/check_release_docs.py --update-fingerprints`")
    return found


def main() -> int:
    if "--update-fingerprints" in sys.argv:
        path = root / "THIRD_PARTY_NOTICES.md"
        raw = path.read_text(encoding="utf8")
        line = f"<!-- lock fingerprints: {fingerprints()} -->"
        raw = MARKER.sub(line, raw) if MARKER.search(raw) else raw.rstrip("\n") + "\n\n" + line + "\n"
        path.write_text(raw, encoding="utf8", newline="")
        print("updated", line)
        return 0
    tag = next((a for a in sys.argv[1:] if not a.startswith("--")), None)
    found = problems(tag)
    for item in found:
        print("release docs:", item)
    if not found:
        print("release docs ok")
    return 1 if found else 0


if __name__ == "__main__":
    sys.exit(main())

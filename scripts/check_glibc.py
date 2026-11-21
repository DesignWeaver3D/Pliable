"""Fail when a program or library inside the Linux AppImage needs a newer C library than the oldest system it should run on.
The AppImage carries its own WebKitGTK and GTK libraries but uses the host's glibc, so every one of them must only need
symbols the oldest supported system has (the Linux catalog test runs on the oldest Ubuntu LTS still in support).

Usage: python scripts/check_glibc.py PATH_TO_APPIMAGE [MAX_VERSION]   (MAX_VERSION defaults to 2.35, the Ubuntu 22.04 glibc)
Needs binutils (objdump); the AppImage is unpacked with --appimage-extract, which needs no FUSE."""
import re, subprocess, sys, tempfile
from pathlib import Path

DEFAULT_MAX = (2, 35)
# objdump -T lists each symbol the file needs from another library as "*UND*" with its version, e.g. (GLIBC_2.34) or GLIBC_2.38.
UNDEFINED = re.compile(r"\*UND\*.*?\(?GLIBC_(\d+)\.(\d+)(?:\.\d+)?\)?\s+(\S+)\s*$")
ELF_MAGIC = b"\x7fELF"


def parse_version(text: str) -> tuple[int, int]:
    major, minor = text.split(".")[:2]
    return int(major), int(minor)


def needed(objdump_text: str) -> dict[tuple[int, int], str]:
    """The glibc versions the file needs from the output of `objdump -T`, each with one symbol that needs it."""
    versions: dict[tuple[int, int], str] = {}
    for line in objdump_text.splitlines():
        match = UNDEFINED.search(line)
        if match:
            versions.setdefault((int(match.group(1)), int(match.group(2))), match.group(3))
    return versions


def too_new(objdump_text: str, limit: tuple[int, int]) -> list[tuple[tuple[int, int], str]]:
    return sorted((version, symbol) for version, symbol in needed(objdump_text).items() if version > limit)


def is_elf(path: Path) -> bool:
    try:
        with path.open("rb") as f:
            return f.read(4) == ELF_MAGIC
    except OSError:
        return False


def scan(folder: Path, limit: tuple[int, int]) -> dict[str, list[tuple[tuple[int, int], str]]]:
    """The files under the folder that need a glibc newer than the limit, by path."""
    problems: dict[str, list[tuple[tuple[int, int], str]]] = {}
    for path in sorted(p for p in folder.rglob("*") if p.is_file() and not p.is_symlink() and is_elf(p)):
        result = subprocess.run(["objdump", "-T", str(path)], capture_output=True, text=True)
        found = too_new(result.stdout, limit)
        if found:
            problems[str(path.relative_to(folder))] = found
    return problems


def main() -> int:
    appimage = Path(sys.argv[1]).resolve()
    limit = parse_version(sys.argv[2]) if len(sys.argv) > 2 else DEFAULT_MAX
    with tempfile.TemporaryDirectory() as work:
        subprocess.run([str(appimage), "--appimage-extract"], cwd=work, check=True, capture_output=True)
        root = Path(work) / "squashfs-root"
        problems = scan(root, limit)
        count = sum(1 for p in root.rglob("*") if p.is_file() and not p.is_symlink() and is_elf(p))
    if problems:
        for name, found in problems.items():
            top = found[-1]
            print(f"{name}: needs GLIBC_{top[0][0]}.{top[0][1]} ({top[1]})")
        print(f"FAILED: {len(problems)} file(s) need a glibc newer than {limit[0]}.{limit[1]}")
        return 1
    print(f"ok: {count} programs and libraries need glibc {limit[0]}.{limit[1]} or older")
    return 0


if __name__ == "__main__":
    sys.exit(main())

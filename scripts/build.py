"""Build the double-clickable desktop app for this computer, from a clean checkout, and say where it is.
Runs the same steps as the desktop workflow: the frontend (app/), the frozen core (core/scripts/build_app.py, with
PyInstaller supplied by `uv run --with`), the Tauri shell and its package (scripts/build_desktop.py).
Needs Node.js (npm), uv and Rust (cargo); on Linux also the WebKitGTK development libraries (see the desktop workflow).
Usage: ./build.sh [LABEL] or build.bat [LABEL]   (LABEL defaults to the platform, e.g. macos-arm64)"""
import platform, shutil, subprocess, sys
from collections.abc import Callable
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TOOLS = {"npm": "Node.js (https://nodejs.org)", "uv": "uv (https://docs.astral.sh/uv)", "cargo": "Rust (https://rustup.rs)"}
SYSTEM_NAMES = {"Darwin": "macos", "Windows": "windows", "Linux": "linux"}
MACHINE_NAMES = {"x86_64": "x64", "amd64": "x64", "aarch64": "arm64", "arm64": "arm64"}


def platform_label(system: str, machine: str) -> str:
    """The release label for a platform, e.g. ("Darwin", "arm64") -> "macos-arm64"."""
    name = SYSTEM_NAMES.get(system, system.lower())
    return f"{name}-{MACHINE_NAMES.get(machine.lower(), machine.lower())}"


def outputs(root: Path, system: str, label: str) -> tuple[Path, Path]:
    """The app to double-click and the file to share, as scripts/build_desktop.py lays them out."""
    dist = root / "desktop" / "dist"
    if system == "Linux":
        image = dist / f"pliable-desktop-{label}.AppImage"
        return image, image
    folder = dist / f"pliable-desktop-{label}"
    app = folder / ("Pliable.app" if system == "Darwin" else "Pliable.exe")
    return app, dist / f"pliable-desktop-{label}.zip"


def missing_tools(which: Callable[[str], str | None] = shutil.which) -> list[str]:
    """The required tools that are not on the PATH, described for the user."""
    return [f"{tool}: install {source}" for tool, source in TOOLS.items() if which(tool) is None]


def run(args: list[str], cwd: Path) -> None:
    print(f"\n==> {' '.join(args)}   (in {cwd.relative_to(ROOT) if cwd != ROOT else '.'})", flush=True)
    subprocess.run([shutil.which(args[0]) or args[0], *args[1:]], cwd=cwd, check=True)


def install_node_packages(folder: Path) -> None:
    """npm ci only when the packages are missing, so a running dev server's node_modules is left alone."""
    if not (folder / "node_modules").is_dir():
        run(["npm", "ci"], folder)


def build(label: str) -> None:
    app_dir, core_dir, desktop_dir = ROOT / "app", ROOT / "core", ROOT / "desktop"
    install_node_packages(app_dir)
    run(["npm", "run", "build"], app_dir)
    run(["uv", "sync"], core_dir)
    run(["uv", "run", "--with", "pyinstaller", "python", "scripts/build_app.py", label], core_dir)
    install_node_packages(desktop_dir)
    run(["uv", "run", "--project", "core", "python", "scripts/build_desktop.py", label], ROOT)


def main() -> None:
    missing = missing_tools()
    if missing:
        sys.exit("Missing build tools:\n  " + "\n  ".join(missing))
    system = platform.system()
    label = sys.argv[1] if len(sys.argv) > 1 else platform_label(system, platform.machine())
    try:
        build(label)
    except subprocess.CalledProcessError as error:
        sys.exit(f"\nBuild failed at: {' '.join(map(str, error.cmd))}")
    app, archive = outputs(ROOT, system, label)
    print(f"\nPliable is built.\n  Double-click: {app}")
    if archive != app:
        print(f"  To share:     {archive}")


if __name__ == "__main__":
    main()

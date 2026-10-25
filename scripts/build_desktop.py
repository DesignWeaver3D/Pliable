"""Assemble the portable desktop app: the Tauri shell next to the frozen core, zipped.
Needs the frozen core first (`python scripts/build_app.py LABEL` in core/) and Rust with the Tauri command line
tool installed (`npm ci` in desktop/).
Usage: python scripts/build_desktop.py [LABEL]   -> desktop/dist/pliable-desktop-LABEL.zip
The folder holds Pliable(.exe), core/ (the frozen core), and a data/ folder is created beside it at run time."""
import platform, shutil, subprocess, sys
from pathlib import Path

root = Path(__file__).resolve().parents[1]
desktop = root / "desktop"
frozen = root / "core" / "dist" / "pliable"
if not frozen.is_dir():
    sys.exit("Freeze the core first: python scripts/build_app.py (in core/)")
label = sys.argv[1] if len(sys.argv) > 1 else f"{platform.system().lower()}-{platform.machine().lower()}"
exe_suffix = ".exe" if platform.system() == "Windows" else ""
npx = "npx.cmd" if platform.system() == "Windows" else "npx"
subprocess.run([npx, "tauri", "build", "--no-bundle"], cwd=desktop, check=True)
shell = desktop / "src-tauri" / "target" / "release" / f"pliable-desktop{exe_suffix}"
folder = desktop / "dist" / f"pliable-desktop-{label}"
shutil.rmtree(folder, ignore_errors=True)
folder.mkdir(parents=True)
shutil.copy2(shell, folder / f"Pliable{exe_suffix}")
shutil.copytree(frozen, folder / "core")
for extra in ("README.md", "LICENSE", "THIRD_PARTY_NOTICES.md"):
    shutil.copy(root / extra, folder / extra)
archive = shutil.make_archive(str(desktop / "dist" / f"pliable-desktop-{label}"), "zip", desktop / "dist", folder.name)
print("built", archive)

"""Assemble the desktop app: the Tauri shell next to the frozen core, zipped (an AppImage on Linux).
Needs the frozen core first (`python scripts/build_app.py LABEL` in core/) and Rust with the Tauri command line
tool installed (`npm ci` in desktop/).
Usage: python scripts/build_desktop.py [LABEL]   -> desktop/dist/pliable-desktop-LABEL.zip (Linux: pliable-desktop-LABEL.AppImage)
The folder holds Pliable(.exe), core/ (the frozen core), and a data/ folder is created beside it at run time. The Linux
AppImage holds the same two in usr/bin and keeps its data in the user's data folder (see data_root in main.rs); it uses the
system's WebKitGTK, like the zip did, and needs appimagetool (downloaded and pinned here when it is not on the PATH)."""
import os, platform, shutil, stat, subprocess, sys, urllib.request
from pathlib import Path

APPIMAGETOOL = "https://github.com/AppImage/appimagetool/releases/download/1.9.0/appimagetool-x86_64.AppImage"
DESKTOP_ENTRY = "\n".join(["[Desktop Entry]", "Type=Application", "Name=Pliable", "Comment=Direct 3D modeling", "Exec=Pliable", "Icon=pliable", "Categories=Graphics;3DGraphics;Engineering;", "Terminal=false", ""])
APP_RUN = "\n".join(["#!/bin/sh", 'HERE="$(dirname "$(readlink -f "$0")")"', 'exec "$HERE/usr/bin/Pliable" "$@"', ""])


def appimage(shell: Path, label: str) -> Path:
    """The shell and the frozen core in an AppDir, packed by appimagetool."""
    dist = desktop / "dist"
    appdir = dist / f"Pliable-{label}.AppDir"
    shutil.rmtree(appdir, ignore_errors=True)
    bin_dir = appdir / "usr" / "bin"
    bin_dir.mkdir(parents=True)
    shutil.copy2(shell, bin_dir / "Pliable")
    shutil.copytree(frozen, bin_dir / "core")
    notices = appdir / "usr" / "share" / "doc" / "pliable"
    notices.mkdir(parents=True)
    for extra in ("README.md", "LICENSE", "THIRD_PARTY_NOTICES.md"):
        shutil.copy(root / extra, notices / extra)
    (appdir / "pliable.desktop").write_text(DESKTOP_ENTRY)
    shutil.copy(desktop / "src-tauri" / "icons" / "128x128.png", appdir / "pliable.png")
    run = appdir / "AppRun"
    run.write_text(APP_RUN)
    run.chmod(run.stat().st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)
    tool = shutil.which("appimagetool")
    if tool is None:
        download = dist / "appimagetool.AppImage"
        urllib.request.urlretrieve(APPIMAGETOOL, download)
        download.chmod(0o755)
        tool = str(download)
    target = dist / f"pliable-desktop-{label}.AppImage"
    target.unlink(missing_ok=True)
    env = {**os.environ, "ARCH": "x86_64", "APPIMAGE_EXTRACT_AND_RUN": "1"}  # extract-and-run: the build machine needs no FUSE
    subprocess.run([tool, str(appdir), str(target)], check=True, env=env)
    target.chmod(0o755)
    return target


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
if platform.system() == "Linux":
    print("built", appimage(shell, label))
    sys.exit(0)
folder = desktop / "dist" / f"pliable-desktop-{label}"
shutil.rmtree(folder, ignore_errors=True)
folder.mkdir(parents=True)
shutil.copy2(shell, folder / f"Pliable{exe_suffix}")
shutil.copytree(frozen, folder / "core")
for extra in ("README.md", "LICENSE", "THIRD_PARTY_NOTICES.md"):
    shutil.copy(root / extra, folder / extra)
archive = shutil.make_archive(str(desktop / "dist" / f"pliable-desktop-{label}"), "zip", desktop / "dist", folder.name)
print("built", archive)

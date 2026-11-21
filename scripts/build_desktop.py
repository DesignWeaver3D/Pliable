"""Assemble the desktop app: the Tauri shell next to the frozen core, zipped (an AppImage on Linux, Pliable.app on macOS).
Needs the frozen core first (`python scripts/build_app.py LABEL` in core/) and Rust with the Tauri command line
tool installed (`npm ci` in desktop/).
Usage: python scripts/build_desktop.py [LABEL]   -> desktop/dist/pliable-desktop-LABEL.zip (Linux: pliable-desktop-x86_64.AppImage)
The folder holds Pliable(.exe), core/ (the frozen core), and a data/ folder is created beside it at run time. The Linux
AppImage holds the same two in usr/bin and keeps its data in the user's data folder (see data_root in main.rs). It runs on
the system's WebKitGTK when there is one and on a private copy bundled in usr/lib-webkit when there is not (see
bundle_webkit.py and desktop/linux/AppRun), and needs appimagetool (downloaded and pinned here when it is not on the PATH).
On macOS the folder holds Pliable.app instead (the shell in Contents/MacOS, core/ in Contents/Resources, ad-hoc signed) and the
app keeps its data in ~/Library/Application Support/Pliable (see data_root in main.rs)."""
import hashlib, json, os, platform, plistlib, shutil, stat, subprocess, sys, urllib.request
from pathlib import Path

from build import appimage_name, platform_label
from bundle_webkit import bundle_webkit

APPIMAGETOOL = "https://github.com/AppImage/appimagetool/releases/download/1.9.0/appimagetool-x86_64.AppImage"
APPIMAGETOOL_SHA256 = "46fdd785094c7f6e545b61afcfb0f3d98d8eab243f644b4b17698c01d06083d1"  # of the 1.9.0 file as downloaded 2026-11-16; the release publishes none
DESKTOP_ENTRY = "\n".join(["[Desktop Entry]", "Type=Application", "Name=Pliable", "Comment=Direct 3D modeling", "Exec=Pliable", "Icon=pliable", "Categories=Graphics;3DGraphics;Engineering;", "Terminal=false", ""])


def appimage(shell: Path, label: str) -> Path:
    """The shell and the frozen core in an AppDir, packed by appimagetool."""
    dist = desktop / "dist"
    appdir = dist / f"Pliable-{label}.AppDir"
    shutil.rmtree(appdir, ignore_errors=True)
    bin_dir = appdir / "usr" / "bin"
    bin_dir.mkdir(parents=True)
    shutil.copy2(shell, bin_dir / "Pliable")
    shutil.copytree(frozen, bin_dir / "core")
    bundle_webkit(appdir / "usr", shell)
    notices = appdir / "usr" / "share" / "doc" / "pliable"
    notices.mkdir(parents=True)
    for extra in ("README.md", "LICENSE", "THIRD_PARTY_NOTICES.md"):
        shutil.copy(root / extra, notices / extra)
    (appdir / "pliable.desktop").write_text(DESKTOP_ENTRY)
    shutil.copy(desktop / "src-tauri" / "icons" / "128x128.png", appdir / "pliable.png")
    run = appdir / "AppRun"
    shutil.copy(desktop / "linux" / "AppRun", run)
    run.chmod(run.stat().st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)
    tool = shutil.which("appimagetool")
    if tool is None:
        download = dist / "appimagetool.AppImage"
        urllib.request.urlretrieve(APPIMAGETOOL, download)
        digest = hashlib.sha256(download.read_bytes()).hexdigest()
        if digest != APPIMAGETOOL_SHA256:
            download.unlink()
            sys.exit(f"appimagetool from {APPIMAGETOOL} has SHA-256 {digest}, expected {APPIMAGETOOL_SHA256}; not running it")
        download.chmod(0o755)
        tool = str(download)
    target = dist / appimage_name(label)
    target.unlink(missing_ok=True)
    env = {**os.environ, "ARCH": "x86_64", "APPIMAGE_EXTRACT_AND_RUN": "1"}  # extract-and-run: the build machine needs no FUSE
    subprocess.run([tool, str(appdir), str(target)], check=True, env=env)
    target.chmod(0o755)
    return target


def app_bundle(shell: Path, folder: Path) -> Path:
    """Pliable.app in the folder: the shell, the frozen core in Resources, the icon and an Info.plist."""
    bundle = folder / "Pliable.app"
    contents = bundle / "Contents"
    (contents / "MacOS").mkdir(parents=True)
    shutil.copytree(frozen, contents / "Resources" / "core", symlinks=True)
    shutil.copy2(shell, contents / "MacOS" / "Pliable")
    shutil.copy(desktop / "src-tauri" / "icons" / "icon.icns", contents / "Resources" / "icon.icns")
    config = json.loads((desktop / "src-tauri" / "tauri.conf.json").read_text(encoding="utf-8"))
    info = {
        "CFBundleName": "Pliable", "CFBundleDisplayName": "Pliable", "CFBundleExecutable": "Pliable",
        "CFBundleIdentifier": config["identifier"], "CFBundleIconFile": "icon.icns", "CFBundlePackageType": "APPL",
        "CFBundleShortVersionString": config["version"], "CFBundleVersion": config["version"],
        "LSMinimumSystemVersion": "10.15", "NSHighResolutionCapable": True,
    }
    (contents / "Info.plist").write_bytes(plistlib.dumps(info))
    subprocess.run(["codesign", "--force", "--sign", "-", str(bundle)], check=True)  # ad-hoc: Apple silicon runs only signed code
    return bundle


root = Path(__file__).resolve().parents[1]
desktop = root / "desktop"
frozen = root / "core" / "dist" / "pliable"
if not frozen.is_dir():
    sys.exit("Freeze the core first: python scripts/build_app.py (in core/)")
label = sys.argv[1] if len(sys.argv) > 1 else platform_label(platform.system(), platform.machine())
exe_suffix = ".exe" if platform.system() == "Windows" else ""
npx = "npx.cmd" if platform.system() == "Windows" else "npx"
subprocess.run([npx, "tauri", "build", "--no-bundle"], cwd=desktop, check=True)
metadata = subprocess.run(["cargo", "metadata", "--format-version", "1", "--no-deps"], cwd=desktop / "src-tauri",
                          check=True, capture_output=True, text=True).stdout  # honors a target-dir set in cargo's config
shell = Path(json.loads(metadata)["target_directory"]) / "release" / f"pliable-desktop{exe_suffix}"
if platform.system() == "Linux":
    print("built", appimage(shell, label))
    sys.exit(0)
folder = desktop / "dist" / f"pliable-desktop-{label}"
shutil.rmtree(folder, ignore_errors=True)
folder.mkdir(parents=True)
if platform.system() == "Darwin":
    app_bundle(shell, folder)
else:
    shutil.copy2(shell, folder / f"Pliable{exe_suffix}")
    shutil.copytree(frozen, folder / "core")
for extra in ("README.md", "LICENSE", "THIRD_PARTY_NOTICES.md"):
    shutil.copy(root / extra, folder / extra)
archive = desktop / "dist" / f"pliable-desktop-{label}.zip"
archive.unlink(missing_ok=True)
if platform.system() == "Darwin":  # ditto keeps the bundle's symlinks and signature; no extended attributes, which unzip would turn into ._ files
    subprocess.run(["ditto", "-c", "-k", "--norsrc", "--noextattr", "--noacl", "--keepParent", str(folder), str(archive)], check=True)
else:
    shutil.make_archive(str(archive.with_suffix("")), "zip", desktop / "dist", folder.name)
print("built", archive)

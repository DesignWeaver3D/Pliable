"""Freeze the launcher into a portable folder with PyInstaller and zip it.
Needs the frontend built first (`npm run build` in app/) and pyinstaller installed (`uv pip install pyinstaller`).
Usage: python scripts/build_app.py [LABEL]   -> core/dist/pliable-LABEL.zip (LABEL defaults to the platform name)"""
import platform, shutil, subprocess, sys
from pathlib import Path

core = Path(__file__).resolve().parents[1]
frontend = core.parent / "app" / "dist"
if not (frontend / "index.html").is_file():
    sys.exit("Build the frontend first: npm run build (in app/)")
label = sys.argv[1] if len(sys.argv) > 1 else f"{platform.system().lower()}-{platform.machine().lower()}"
sep = ";" if platform.system() == "Windows" else ":"
subprocess.run([
    sys.executable, "-m", "PyInstaller", "--noconfirm", "--clean", "--name", "pliable", "--console",
    "--paths", str(core / "src"),
    "--add-data", f"{frontend}{sep}frontend",
    "--collect-all", "OCP", "--collect-all", "build123d", "--collect-all", "py_slvs", "--collect-all", "lib3mf",
    "--distpath", str(core / "dist"), "--workpath", str(core / "build"), "--specpath", str(core / "build"),
    str(core / "src" / "pliable" / "launcher_entry.py"),
], check=True)
for extra in ("README.md", "LICENSE", "THIRD_PARTY_NOTICES.md"):
    shutil.copy(core.parent / extra, core / "dist" / "pliable" / extra)
archive = shutil.make_archive(str(core / "dist" / f"pliable-{label}"), "zip", core / "dist", "pliable")
print("built", archive)

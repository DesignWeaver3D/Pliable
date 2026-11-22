"""Put a private copy of WebKitGTK and the libraries it needs into the Linux AppDir (used by build_desktop.py).
The AppImage runs on the system's WebKitGTK when the system has one; desktop/linux/AppRun switches to this copy only
when the system has none (or PLIABLE_BUNDLED_WEBKIT is set). Layout inside the AppDir, all under usr/:
  lib-webkit/                    every library the shell and WebKit load, except the ones every system supplies
  lib-webkit/webkit2gtk-4.1/     WebKit's web, network and GPU helper programs and its injected bundle
  share-webkit/glib-2.0/schemas  the compiled GSettings schemas GTK needs
WebKit finds its helper programs at a path compiled into the library (/usr/lib/<arch>/webkit2gtk-4.1) and has no
setting to change it, so the bundled copy of the library gets that path rewritten to ./lib-webkit/webkit2gtk-4.1,
relative to the AppDir's usr folder, which AppRun makes the working directory in this mode."""
import re, shutil, subprocess
from pathlib import Path
from typing import Callable

LIB_FOLDER = "lib-webkit"
HELPER_NAME = "webkit2gtk-4.1"
RELATIVE_ROOT = f"./{LIB_FOLDER}"
# Libraries every system supplies and that depend on the machine itself (the C library, the graphics driver stack,
# the X11 client libraries and the device manager): bundling them breaks more than it fixes.
EXCLUDED_PREFIXES = (
    "ld-linux", "linux-vdso", "libc.so", "libm.so", "libdl.so", "libpthread.so", "librt.so", "libresolv.so", "libutil.so",
    "libnsl.so", "libnss_", "libanl.so", "libthread_db.so",
    "libGL.so", "libGLX.so", "libGLdispatch.so", "libOpenGL.so", "libEGL.so", "libGLESv2.so", "libGLESv1_CM.so", "libgbm.so",
    "libdrm.so", "libglapi.so", "libvulkan.so",
    "libX11.so", "libX11-xcb.so", "libxcb.so", "libxcb-dri", "libxcb-glx.so", "libxcb-present.so", "libxcb-sync.so", "libxcb-xfixes.so",
    "libudev.so",
)
LDD_LINE = re.compile(r"^\s*(\S+) => (\S+) \(0x[0-9a-f]+\)\s*$")
Runner = Callable[[Path], str]


def parse_ldd(text: str) -> dict[str, Path]:
    """The libraries `ldd` found, by file name; a library it reports as missing is an error."""
    found: dict[str, Path] = {}
    for line in text.splitlines():
        if "not found" in line:
            raise RuntimeError(f"A library is missing on the build machine: {line.strip()}")
        match = LDD_LINE.match(line)
        if match:
            found[match.group(1)] = Path(match.group(2))
    return found


def is_excluded(name: str) -> bool:
    return name.startswith(EXCLUDED_PREFIXES)


def run_ldd(program: Path) -> str:
    return subprocess.run(["ldd", str(program)], check=True, capture_output=True, text=True).stdout


def collect(programs: list[Path], ldd: Runner = run_ldd) -> dict[str, Path]:
    """Every library the programs load, by file name, without the excluded ones."""
    libraries: dict[str, Path] = {}
    for program in programs:
        for name, path in parse_ldd(ldd(program)).items():
            if not is_excluded(name):
                libraries.setdefault(name, path)
    return libraries


def patch_helper_path(data: bytes, library_dir: str) -> tuple[bytes, int]:
    """The library's bytes with each compiled-in WebKit helper path pointed into the AppDir, and how many it changed.
    The old folder (library_dir) becomes ./lib-webkit padded with slashes to the same length; the rest of the path and
    every other string stay as they are."""
    if len(library_dir) < len(RELATIVE_ROOT):
        raise RuntimeError(f"The library folder {library_dir} is too short to hold {RELATIVE_ROOT}")
    old = f"{library_dir}/{HELPER_NAME}".encode()
    new = (RELATIVE_ROOT.ljust(len(library_dir), "/") + f"/{HELPER_NAME}").encode()
    return data.replace(old, new), data.count(old)


def bundle_webkit(usr: Path, shell: Path, ldd: Runner = run_ldd) -> Path:
    """Copy WebKitGTK, its helpers and the libraries they load into usr (the AppDir's usr folder); returns the library folder."""
    shell_libraries = parse_ldd(ldd(shell))
    webkit = shell_libraries.get("libwebkit2gtk-4.1.so.0")
    if webkit is None:
        raise RuntimeError("The shell does not load libwebkit2gtk-4.1.so.0; install libwebkit2gtk-4.1-dev before building")
    webkit = webkit.resolve()
    helper_source = webkit.parent / HELPER_NAME
    if not helper_source.is_dir():
        raise RuntimeError(f"WebKit's helper programs were not found at {helper_source}")
    target = usr / LIB_FOLDER
    helpers = target / HELPER_NAME
    shutil.copytree(helper_source, helpers, ignore=shutil.ignore_patterns("MiniBrowser"))
    programs = [shell, *(path for path in helpers.rglob("*") if path.is_file() and not path.is_symlink())]
    for name, path in collect(programs, ldd).items():
        shutil.copy2(path.resolve(), target / name)
    library = target / "libwebkit2gtk-4.1.so.0"
    patched, count = patch_helper_path(library.read_bytes(), str(webkit.parent))
    if count < 1:
        raise RuntimeError(f"No WebKit helper path was found in {webkit} to point into the AppImage")
    library.write_bytes(patched)
    schemas = Path("/usr/share/glib-2.0/schemas/gschemas.compiled")
    if schemas.is_file():
        folder = usr / "share-webkit" / "glib-2.0" / "schemas"
        folder.mkdir(parents=True)
        shutil.copy2(schemas, folder / schemas.name)
    return target

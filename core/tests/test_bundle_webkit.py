import importlib.util
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("pliable_bundle_webkit", ROOT / "scripts" / "bundle_webkit.py")
bundler = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bundler)

LDD_OUTPUT = """\tlinux-vdso.so.1 (0x00007ffd5b9f4000)
\tlibwebkit2gtk-4.1.so.0 => /usr/lib/x86_64-linux-gnu/libwebkit2gtk-4.1.so.0 (0x00007f3a1c000000)
\tlibc.so.6 => /lib/x86_64-linux-gnu/libc.so.6 (0x00007f3a1bc00000)
\tlibGL.so.1 => /lib/x86_64-linux-gnu/libGL.so.1 (0x00007f3a1bb00000)
\tlibstdc++.so.6 => /lib/x86_64-linux-gnu/libstdc++.so.6 (0x00007f3a1b800000)
\t/lib64/ld-linux-x86-64.so.2 (0x00007f3a1d000000)
"""


def test_parse_ldd_reads_the_resolved_libraries_and_skips_the_loader_lines() -> None:
    found = bundler.parse_ldd(LDD_OUTPUT)
    assert found["libwebkit2gtk-4.1.so.0"] == Path("/usr/lib/x86_64-linux-gnu/libwebkit2gtk-4.1.so.0")
    assert "linux-vdso.so.1" not in found and "/lib64/ld-linux-x86-64.so.2" not in found
    assert len(found) == 4


def test_parse_ldd_refuses_a_missing_library() -> None:
    with pytest.raises(RuntimeError, match="libfoo.so.1"):
        bundler.parse_ldd("\tlibfoo.so.1 => not found\n")


@pytest.mark.parametrize("name, excluded", [
    ("libc.so.6", True), ("libm.so.6", True), ("ld-linux-x86-64.so.2", True), ("libGL.so.1", True), ("libEGL.so.1", True),
    ("libX11.so.6", True), ("libxcb.so.1", True), ("libudev.so.1", True),
    ("libwebkit2gtk-4.1.so.0", False), ("libstdc++.so.6", False), ("libcairo.so.2", False), ("libmount.so.1", False),
    ("libglib-2.0.so.0", False), ("libGLESv2.so.2", True), ("libgtk-3.so.0", False),
])
def test_system_libraries_are_not_bundled(name: str, excluded: bool) -> None:
    assert bundler.is_excluded(name) is excluded


def test_collect_keeps_each_library_once_without_the_excluded_ones() -> None:
    outputs = {Path("a"): LDD_OUTPUT, Path("b"): "\tlibstdc++.so.6 => /elsewhere/libstdc++.so.6 (0x1)\n\tlibz.so.1 => /lib/libz.so.1 (0x2)\n"}
    found = bundler.collect([Path("a"), Path("b")], lambda program: outputs[program])
    assert sorted(found) == ["libstdc++.so.6", "libwebkit2gtk-4.1.so.0", "libz.so.1"]
    assert found["libstdc++.so.6"] == Path("/lib/x86_64-linux-gnu/libstdc++.so.6")


def test_patch_helper_path_points_the_helper_folder_into_the_app_dir_without_changing_lengths() -> None:
    folder = "/usr/lib/x86_64-linux-gnu"
    data = (b"\x00" + f"{folder}/webkit2gtk-4.1".encode() + b"\x00" + f"{folder}/webkit2gtk-4.1/injected-bundle/".encode()
            + b"\x00" + folder.encode() + b"\x00/usr/share\x00")
    patched, count = bundler.patch_helper_path(data, folder)
    assert count == 2 and len(patched) == len(data)
    assert b"./lib-webkit/////////////" + b"/webkit2gtk-4.1\x00" in patched
    assert b"/webkit2gtk-4.1/injected-bundle/\x00" in patched
    assert patched.count(folder.encode()) == 1  # the bare folder (not a helper path) is left alone
    assert patched.endswith(b"/usr/share\x00")


def test_patch_helper_path_refuses_a_folder_too_short_for_the_new_path() -> None:
    with pytest.raises(RuntimeError, match="too short"):
        bundler.patch_helper_path(b"", "/usr/lib64")


def test_bundle_webkit_copies_the_libraries_and_helpers_and_patches_the_library(tmp_path: Path) -> None:
    system = tmp_path / "system" / "lib" / "x86_64-linux-gnu"
    (system / "webkit2gtk-4.1" / "injected-bundle").mkdir(parents=True)
    webkit_text = f"\x00{system}/webkit2gtk-4.1\x00".encode()
    (system / "libwebkit2gtk-4.1.so.0").write_bytes(webkit_text)
    (system / "libother.so.1").write_bytes(b"other")
    (system / "libc.so.6").write_bytes(b"c")
    for helper in ("WebKitWebProcess", "WebKitNetworkProcess", "MiniBrowser", "injected-bundle/libinjected.so"):
        (system / "webkit2gtk-4.1" / helper).write_bytes(b"helper")
    shell = tmp_path / "Pliable"
    shell.write_bytes(b"shell")

    def ldd(program: Path) -> str:
        names = ["libwebkit2gtk-4.1.so.0", "libother.so.1", "libc.so.6"]
        return "".join(f"\t{name} => {system / name} (0x1)\n" for name in names)

    usr = tmp_path / "AppDir" / "usr"
    usr.mkdir(parents=True)
    target = bundler.bundle_webkit(usr, shell, ldd)
    assert target == usr / "lib-webkit"
    assert (target / "libother.so.1").read_bytes() == b"other"
    assert not (target / "libc.so.6").exists()
    assert (target / "webkit2gtk-4.1" / "WebKitWebProcess").is_file()
    assert (target / "webkit2gtk-4.1" / "injected-bundle" / "libinjected.so").is_file()
    assert not (target / "webkit2gtk-4.1" / "MiniBrowser").exists()
    patched = (target / "libwebkit2gtk-4.1.so.0").read_bytes()
    assert b"./lib-webkit" in patched and str(system).encode() not in patched
    assert (system / "libwebkit2gtk-4.1.so.0").read_bytes() == webkit_text  # the system copy is untouched


def test_bundle_webkit_needs_the_shell_to_load_webkit(tmp_path: Path) -> None:
    with pytest.raises(RuntimeError, match="libwebkit2gtk-4.1"):
        bundler.bundle_webkit(tmp_path, tmp_path / "Pliable", lambda program: "\tlibc.so.6 => /lib/libc.so.6 (0x1)\n")


APP_RUN = ROOT / "desktop" / "linux" / "AppRun"
posix_only = pytest.mark.skipif(sys.platform == "win32", reason="AppRun is a Linux shell script")


def app_dir(tmp_path: Path, bundled: bool = True) -> Path:
    """A fake AppDir whose Pliable prints what AppRun set up, with stub tools so only the test decides what the system has."""
    appdir = tmp_path / "AppDir"
    (appdir / "usr" / "bin").mkdir(parents=True)
    shutil.copy(APP_RUN, appdir / "AppRun")
    program = appdir / "usr" / "bin" / "Pliable"
    program.write_text('#!/bin/sh\necho "libs=$LD_LIBRARY_PATH dirs=$XDG_DATA_DIRS cwd=$(pwd) args=$*"\n')
    program.chmod(0o755)
    if bundled:
        (appdir / "usr" / "lib-webkit").mkdir()
    return appdir


def run_app_run(tmp_path: Path, appdir: Path, system_dirs: list[Path], ldconfig: str = "", **env: str) -> str:
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    for tool in ("dirname", "readlink", "grep"):
        (bin_dir / tool).symlink_to(shutil.which(tool))
    stub = bin_dir / "ldconfig"
    stub.write_text(f"#!/bin/sh\necho '{ldconfig}'\n")
    stub.chmod(0o755)
    everything = {"PATH": str(bin_dir), "PLIABLE_SYSTEM_LIB_DIRS": " ".join(map(str, system_dirs)), "HOME": str(tmp_path), **env}
    run = subprocess.run(["/bin/sh", str(appdir / "AppRun"), "one", "two"], cwd=tmp_path, env=everything, capture_output=True, text=True)
    assert run.returncode == 0, run.stderr
    return run.stdout.strip()


@posix_only
def test_app_run_uses_the_system_webkit_when_the_system_has_one(tmp_path: Path) -> None:
    system = tmp_path / "system"
    system.mkdir()
    (system / "libwebkit2gtk-4.1.so.0").write_bytes(b"")
    out = run_app_run(tmp_path, app_dir(tmp_path), [system])
    assert out == f"libs= dirs= cwd={tmp_path} args=one two"


@posix_only
def test_app_run_finds_the_system_webkit_through_ldconfig(tmp_path: Path) -> None:
    empty = tmp_path / "empty"
    empty.mkdir()
    out = run_app_run(tmp_path, app_dir(tmp_path), [empty], ldconfig="\tlibwebkit2gtk-4.1.so.0 (libc6,x86-64) => /opt/lib/libwebkit2gtk-4.1.so.0")
    assert "libs= " in out and f"cwd={tmp_path}" in out


@posix_only
def test_app_run_switches_to_the_bundled_webkit_when_the_system_has_none(tmp_path: Path) -> None:
    empty = tmp_path / "empty"
    empty.mkdir()
    appdir = app_dir(tmp_path)
    out = run_app_run(tmp_path, appdir, [empty])
    assert f"libs={appdir}/usr/lib-webkit " in out
    assert f"dirs={appdir}/usr/share-webkit:/usr/local/share:/usr/share " in out
    assert f"cwd={appdir}/usr " in out and out.endswith("args=one two")


@posix_only
def test_app_run_can_be_forced_to_the_bundled_webkit_and_keeps_an_existing_library_path(tmp_path: Path) -> None:
    system = tmp_path / "system"
    system.mkdir()
    (system / "libwebkit2gtk-4.1.so.0").write_bytes(b"")
    appdir = app_dir(tmp_path)
    out = run_app_run(tmp_path, appdir, [system], PLIABLE_BUNDLED_WEBKIT="1", LD_LIBRARY_PATH="/opt/x")
    assert f"libs={appdir}/usr/lib-webkit:/opt/x " in out


@posix_only
def test_app_run_without_a_bundle_never_changes_the_environment(tmp_path: Path) -> None:
    empty = tmp_path / "empty"
    empty.mkdir()
    out = run_app_run(tmp_path, app_dir(tmp_path, bundled=False), [empty], PLIABLE_BUNDLED_WEBKIT="1")
    assert out == f"libs= dirs= cwd={tmp_path} args=one two"

import importlib.util
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parents[2] / "scripts" / "build.py"
spec = importlib.util.spec_from_file_location("pliable_build_script", SCRIPT)
build = importlib.util.module_from_spec(spec)
spec.loader.exec_module(build)


@pytest.mark.parametrize("system, machine, label", [
    ("Darwin", "arm64", "macos-arm64"),
    ("Darwin", "x86_64", "macos-x64"),
    ("Windows", "AMD64", "windows-x64"),
    ("Linux", "x86_64", "linux-x64"),
    ("Linux", "aarch64", "linux-arm64"),
])
def test_platform_label_matches_the_release_labels(system: str, machine: str, label: str) -> None:
    assert build.platform_label(system, machine) == label


def test_appimage_name_has_the_architecture_and_not_the_word_linux() -> None:
    assert build.appimage_name("linux-x64") == "pliable-desktop-x86_64.AppImage"
    assert build.appimage_name("linux-arm64") == "pliable-desktop-aarch64.AppImage"


def test_outputs_name_the_app_to_double_click_and_the_file_to_share() -> None:
    dist = Path("/r/desktop/dist")
    assert build.outputs(Path("/r"), "Darwin", "macos-arm64") == (
        dist / "pliable-desktop-macos-arm64" / "Pliable.app", dist / "pliable-desktop-macos-arm64.zip")
    assert build.outputs(Path("/r"), "Windows", "windows-x64") == (
        dist / "pliable-desktop-windows-x64" / "Pliable.exe", dist / "pliable-desktop-windows-x64.zip")
    image = dist / "pliable-desktop-x86_64.AppImage"
    assert build.outputs(Path("/r"), "Linux", "linux-x64") == (image, image)


BUILD_SH = SCRIPT.parents[1] / "build.sh"
TOOL_STUBS = {"uv": "echo uv ran", "node": "echo v24.1.0", "npm": "", "cargo": "", "cc": "", "pkg-config": "", "xcode-select": ""}


def stub_path(tmp_path: Path, system: str, stubs: dict[str, str]) -> str:
    """A PATH with only dirname, a uname for the given platform and the given stub tools."""
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    (bin_dir / "dirname").symlink_to(shutil.which("dirname"))
    uname = f'[ "$1" = "-m" ] && echo x86_64 || echo {system}'
    for name, body in {**stubs, "uname": uname}.items():
        tool = bin_dir / name
        tool.write_text(f"#!/bin/sh\n{body}\n")
        tool.chmod(0o755)
    return str(bin_dir)


def run_build_sh(tmp_path: Path, system: str, stubs: dict[str, str], args: tuple[str, ...] = ("--check",)) -> subprocess.CompletedProcess:
    env = {"PATH": stub_path(tmp_path, system, stubs), "HOME": str(tmp_path)}
    return subprocess.run(["/bin/sh", str(BUILD_SH), *args], env=env, capture_output=True, text=True)


posix_only = pytest.mark.skipif(sys.platform == "win32", reason="build.sh is for macOS and Linux")


@posix_only
@pytest.mark.parametrize("system, platform_items", [
    ("Darwin", ["Xcode Command Line Tools"]),
    ("Linux", ["a C compiler", "pkg-config and the WebKitGTK development libraries"]),
])
def test_build_sh_lists_every_missing_prerequisite_at_once(tmp_path: Path, system: str, platform_items: list[str]) -> None:
    result = run_build_sh(tmp_path, system, {})
    assert result.returncode == 1
    for item in ["uv: https://", "Node.js 20.19+ or 22.12+: https://", "Rust: https://rustup.rs", *platform_items]:
        assert f"  - {item}" in result.stderr


@posix_only
@pytest.mark.parametrize("version, ok", [("v18.20.0", False), ("v20.18.1", False), ("v20.19.0", True), ("v21.7.0", False),
                                         ("v22.11.0", False), ("v22.12.0", True), ("v24.1.0", True),
                                         ("v24.0.0-nightly2026", True), ("v22.11.0-rc.1", False), ("garbage", False), ("v24", False)])
def test_build_sh_checks_the_node_version(tmp_path: Path, version: str, ok: bool) -> None:
    result = run_build_sh(tmp_path, "Darwin", {**TOOL_STUBS, "node": f"echo {version}"})
    assert (result.returncode == 0) == ok
    assert (f"found {version}" in result.stderr) != ok


@posix_only
def test_build_sh_names_the_missing_linux_libraries(tmp_path: Path) -> None:
    pkg_config = '[ "$2" = "gtk+-3.0" ]'
    result = run_build_sh(tmp_path, "Linux", {**TOOL_STUBS, "pkg-config": pkg_config})
    assert result.returncode == 1
    assert "development libraries (webkit2gtk-4.1 librsvg-2.0):" in result.stderr


@posix_only
@pytest.mark.parametrize("system", ["Darwin", "Linux"])
def test_build_sh_check_passes_without_building_when_everything_is_present(tmp_path: Path, system: str) -> None:
    result = run_build_sh(tmp_path, system, TOOL_STUBS)
    assert result.returncode == 0, result.stderr
    assert result.stdout.strip() == "All prerequisites found."


@posix_only
def test_build_sh_without_arguments_goes_on_to_the_build(tmp_path: Path) -> None:
    result = run_build_sh(tmp_path, "Darwin", TOOL_STUBS, args=())
    assert result.returncode == 0, result.stderr
    assert result.stdout.strip() == "uv ran"

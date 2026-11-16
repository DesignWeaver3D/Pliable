import importlib.util
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


def test_outputs_name_the_app_to_double_click_and_the_file_to_share() -> None:
    dist = Path("/r/desktop/dist")
    assert build.outputs(Path("/r"), "Darwin", "macos-arm64") == (
        dist / "pliable-desktop-macos-arm64" / "Pliable.app", dist / "pliable-desktop-macos-arm64.zip")
    assert build.outputs(Path("/r"), "Windows", "windows-x64") == (
        dist / "pliable-desktop-windows-x64" / "Pliable.exe", dist / "pliable-desktop-windows-x64.zip")
    image = dist / "pliable-desktop-linux-x64.AppImage"
    assert build.outputs(Path("/r"), "Linux", "linux-x64") == (image, image)


def test_missing_tools_lists_only_the_absent_ones() -> None:
    found = {"npm": "/bin/npm", "uv": "/bin/uv"}
    assert build.missing_tools(found.get) == ["cargo: install Rust (https://rustup.rs)"]
    assert build.missing_tools(lambda tool: "/bin/" + tool) == []

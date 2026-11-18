"""Starting the built desktop program for a shell test: a copy in a temporary folder, so its data and saved files stay out of a person's own."""

import os
import shutil
import signal
import subprocess
import sys
from collections.abc import Iterator
from pathlib import Path

import pytest

from macos_ui import DesktopApp, wait_until


def pytest_addoption(parser: pytest.Parser) -> None:
    parser.addoption("--app", help="the built program: Pliable.app, or the folder that holds Pliable and core/")


def program_parts(app: Path) -> tuple[Path, Path]:
    """The shell program and the frozen core's folder inside a built app, bundle or plain folder."""
    if app.suffix == ".app":
        return app / "Contents" / "MacOS" / "Pliable", app / "Contents" / "Resources" / "core"
    return app / "Pliable", app / "core"


def children_of(pid: int) -> list[int]:
    """The process ids of a process's direct children."""
    found = subprocess.run(["pgrep", "-P", str(pid)], capture_output=True, text=True).stdout.split()
    return [int(child) for child in found]


def stop(pids: list[int]) -> None:
    for pid in pids:
        try:
            os.kill(pid, signal.SIGKILL)
        except ProcessLookupError:
            pass


@pytest.fixture
def save_folder(tmp_path: Path) -> Path:
    """Where the program's Save As dialog starts during a test."""
    folder = tmp_path / "saved"
    folder.mkdir()
    return folder


@pytest.fixture
def app(request: pytest.FixtureRequest, tmp_path: Path, save_folder: Path) -> Iterator[DesktopApp]:
    """The program, started from a temporary copy: beside a plain program the shell keeps its data in that folder."""
    if sys.platform != "darwin":
        pytest.skip("These shell tests drive the macOS accessibility system")
    given = request.config.getoption("--app")
    if not given:
        pytest.fail("Pass --app with the built program (Pliable.app, or the folder that holds Pliable and core/)")
    shell, core = program_parts(Path(given).resolve())
    if not shell.is_file() or not core.is_dir():
        pytest.fail(f"No built program at {given}: expected {shell} and {core}")
    home = tmp_path / "program"
    home.mkdir()
    shutil.copy2(shell, home / "Pliable")
    (home / "core").symlink_to(core, target_is_directory=True)
    process = subprocess.Popen([str(home / "Pliable")], env={**os.environ, "PLIABLE_SAVE_DIR": str(save_folder)},
                               stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    log = home / "data" / "core.log"
    started: list[int] = []
    try:
        wait_until(lambda: log.is_file() and "client connected" in log.read_text(errors="replace"), "the page to connect to the core", 60)
        started = children_of(process.pid)
        yield DesktopApp(process)
    finally:
        started = started or children_of(process.pid)
        stop([process.pid, *started])
        process.wait(timeout=10)

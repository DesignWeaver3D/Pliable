"""Driving the desktop program on macOS for the shell tests: its windows, menus, buttons and sheets, through the accessibility system."""

import subprocess
import time
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

SCRIPT = Path(__file__).with_name("macos_ui.applescript")


@dataclass(frozen=True)
class Sheet:
    """A sheet on the main window: a question from the shell, or the Save As panel."""

    buttons: tuple[str, ...]
    texts: tuple[str, ...]


def wait_until(condition: Callable[[], bool], what: str, seconds: float = 15.0) -> None:
    """Poll until the condition holds; fail with what was waited for."""
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        if condition():
            return
        time.sleep(0.25)
    raise AssertionError(f"Waited {seconds:.0f} s for: {what}")


def parse_sheet(reply: str) -> Sheet | None:
    """The sheet a `sheet` reply describes, or None when it says there is none."""
    if reply == "none":
        return None
    fields = {line.split("\t")[0]: tuple(part for part in line.split("\t")[1:] if part) for line in reply.splitlines()}
    return Sheet(fields.get("buttons", ()), fields.get("texts", ()))


class DesktopApp:
    """One running copy of the program, by its process id."""

    def __init__(self, process: subprocess.Popen) -> None:
        self.process = process

    def _ui(self, verb: str, *arguments: str) -> str:
        result = subprocess.run(["osascript", str(SCRIPT), str(self.process.pid), verb, *arguments],
                                capture_output=True, text=True, timeout=60)
        if result.returncode != 0:
            raise AssertionError(f"Accessibility request `{verb}` failed: {result.stderr.strip()}")
        return result.stdout.rstrip("\n")

    def running(self) -> bool:
        return self.process.poll() is None

    def window_titles(self) -> list[str]:
        return [title for title in self._ui("titles").split("\t") if title]

    def buttons(self) -> list[str]:
        """The names of every button in the program's windows, the page's included."""
        return [name for name in self._ui("buttons").split("\t") if name and name != "missing value"]

    def has_button(self, name: str) -> bool:
        return name.lower() in (button.lower() for button in self.buttons())

    def press(self, name: str) -> None:
        """Press a button by its name, once it is there."""
        wait_until(lambda: self._ui("press", name) == "pressed", f"a button named {name!r} to press")

    def choose(self, menu: str, entry: str) -> None:
        """Choose an entry of a menu in the menu bar."""
        self._ui("menu", menu, entry)

    def close_window(self) -> None:
        """Press the main window's close button."""
        self._ui("close")

    def bring_forward(self) -> None:
        """Make the program the one in front. Needed only for the Save As panel: macOS disables its Save button otherwise."""
        self._ui("front")

    def sheet(self) -> Sheet | None:
        return parse_sheet(self._ui("sheet"))

    def wait_for_sheet(self, button: str) -> Sheet:
        """The sheet that has this button, once it shows."""
        wait_until(lambda: (sheet := self.sheet()) is not None and button in sheet.buttons, f"a sheet with a {button!r} button")
        sheet = self.sheet()
        assert sheet is not None
        return sheet

    def press_in_sheet(self, button: str) -> None:
        self._ui("sheetpress", button)

    def answer_sheet(self, button: str) -> None:
        """Press a button of the sheet and wait for the sheet to close, pressing again if it was not ready the first time."""
        def closed() -> bool:
            if self.sheet() is None:
                return True
            self.press_in_sheet(button)
            return False
        wait_until(closed, f"the sheet to close after {button!r}")

    def wait_for_exit(self, seconds: float = 15.0) -> None:
        wait_until(lambda: not self.running(), "the program to quit", seconds)

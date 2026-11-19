"""The desktop program's own parts on macOS: its window, the first-run notice, quitting and closing with unsaved work, and Save As."""

import os
from pathlib import Path

from conftest import children_of
from macos_ui import DesktopApp, wait_until

QUESTION = "Quit without saving?"


def make_ready(app: DesktopApp) -> None:
    """Close the first-run notice. The Getting started card is left alone: closing it is remembered in the window's own
    storage, which on macOS every copy of the program shares, so a test that closed it would close it for the person too.
    Buttons are pressed by name, so the card does not get in the way."""
    app.press("I understand")


def add_a_box(app: DesktopApp) -> None:
    """One edit to the model, made with the page's own buttons."""
    app.press("Add box")
    app.press("Apply")
    wait_until(lambda: app.has_button("▾ Bodies 2"), "the second body in the list")


def alive(pid: int) -> bool:
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    return True


def ask_to_quit(app: DesktopApp) -> None:
    app.choose("Pliable", "Quit Pliable")


def assert_asks(app: DesktopApp) -> None:
    sheet = app.wait_for_sheet("Quit")
    assert "Cancel" in sheet.buttons
    assert any(QUESTION in text for text in sheet.texts)
    assert app.running()


def test_the_window_opens_with_the_first_run_notice(app: DesktopApp) -> None:
    assert any(title.startswith("Pliable ") for title in app.window_titles())
    assert app.has_button("I understand")
    make_ready(app)
    wait_until(lambda: not app.has_button("I understand"), "the notice to close")


def test_quit_with_nothing_unsaved_quits_at_once_and_stops_the_core(app: DesktopApp) -> None:
    make_ready(app)
    core = children_of(app.process.pid)
    assert core, "the shell started a core"
    ask_to_quit(app)
    app.wait_for_exit()
    wait_until(lambda: not any(alive(pid) for pid in core), "the core to stop")


def test_quit_with_an_edit_asks_and_cancel_keeps_the_program_open(app: DesktopApp) -> None:
    make_ready(app)
    add_a_box(app)
    ask_to_quit(app)
    assert_asks(app)
    app.answer_sheet("Cancel")
    assert app.running()
    ask_to_quit(app)  # it can be asked again
    assert_asks(app)
    app.press_in_sheet("Quit")
    app.wait_for_exit()


def test_the_close_button_with_an_edit_asks_too(app: DesktopApp) -> None:
    make_ready(app)
    add_a_box(app)
    app.close_window()
    assert_asks(app)
    app.press_in_sheet("Quit")
    app.wait_for_exit()


def test_an_open_sketch_counts_as_unsaved_work(app: DesktopApp) -> None:
    make_ready(app)
    app.press("XY")
    wait_until(lambda: app.has_button("Finish sketch"), "the sketch to open")
    ask_to_quit(app)
    assert_asks(app)


def test_a_cancelled_save_leaves_the_work_unsaved(app: DesktopApp, save_folder: Path) -> None:
    make_ready(app)
    add_a_box(app)
    app.press("PLIABLE")
    app.press("Save Project")
    app.wait_for_sheet("Save")
    app.answer_sheet("Cancel")
    assert not list(save_folder.iterdir())
    ask_to_quit(app)
    assert_asks(app)


def test_a_saved_project_is_written_and_quitting_then_does_not_ask(may_take_focus: None, app: DesktopApp, save_folder: Path) -> None:
    make_ready(app)
    add_a_box(app)
    app.press("PLIABLE")
    app.press("Save Project")
    app.wait_for_sheet("Save")
    app.bring_forward()  # the panel's Save button is disabled while another program is in front
    app.answer_sheet("Save")
    wait_until(lambda: any(path.suffix == ".plbl" and path.stat().st_size > 0 for path in save_folder.iterdir()), "the project file")
    ask_to_quit(app)
    app.wait_for_exit()


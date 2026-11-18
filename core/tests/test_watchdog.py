import time

from pliable.watchdog import watching


def test_slow_request_writes_thread_stacks(tmp_path):
    path = tmp_path / "stacks.txt"
    with path.open("w") as stream:
        with watching(0.2, stream=stream):
            time.sleep(0.7)
    assert path.read_text().count("most recent call first") >= 1


def test_slow_request_is_dumped_only_once(tmp_path):
    path = tmp_path / "stacks.txt"
    with path.open("w") as stream:
        with watching(0.2, stream=stream):
            time.sleep(0.9)  # more than four times the limit
    text = path.read_text()
    assert text.count("Timeout (") == 1


def test_quick_request_writes_nothing(tmp_path):
    path = tmp_path / "stacks.txt"
    with path.open("w") as stream:
        with watching(0.5, stream=stream):
            pass
        time.sleep(0.8)  # the timer was cancelled: nothing fires later
    assert path.read_text() == ""


def test_error_in_request_still_cancels_the_timer(tmp_path):
    path = tmp_path / "stacks.txt"
    with path.open("w") as stream:
        try:
            with watching(0.3, stream=stream):
                raise ValueError("boom")
        except ValueError:
            pass
        time.sleep(0.6)
    assert path.read_text() == ""

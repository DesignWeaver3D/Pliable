import importlib.util
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parents[2] / "scripts" / "check.py"
spec = importlib.util.spec_from_file_location("pliable_check_script", SCRIPT)
check = importlib.util.module_from_spec(spec)
spec.loader.exec_module(check)


@pytest.mark.parametrize("paths, suites", [
    ([], ["rules"]),
    (["README.md", "docs/behavior.md"], ["rules"]),
    ([".github/workflows/ci.yml", ".githooks/pre-push"], ["rules"]),
    (["app/src/keys.ts"], ["rules", "app"]),
    (["core/src/pliable/serving.py"], ["rules", "core"]),
    (["desktop/src-tauri/src/main.rs"], ["rules", "shell"]),
    (["scripts/check.py"], ["rules", "core"]),
    (["build.sh"], ["rules", "core"]),
    (["core/pyproject.toml", "app/package.json", "desktop/package.json"], ["rules", "app", "shell", "core"]),
])
def test_suites_follow_the_changed_files(paths: list[str], suites: list[str]) -> None:
    assert check.suites_for(paths) == suites


def test_a_folder_name_must_match_from_its_start() -> None:
    assert check.suites_for(["docs/app/notes.md", "tools/core/x.py"]) == ["rules"]


def test_every_suite_has_commands_in_existing_folders() -> None:
    for suite in check.ORDER:
        commands = check.commands_for(suite, "main")
        assert commands
        for command, folder in commands:
            assert command and (check.ROOT / folder).is_dir()


def test_the_rule_checks_compare_with_the_base() -> None:
    ranges = [command for command, _ in check.commands_for("rules", "upstream/main") if "--range" in command]
    assert ranges and ranges[0][-1] == "upstream/main..HEAD"

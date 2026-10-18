"""Every registered tool must carry a tooltip description, so new tools cannot be added without one."""

from pliable.tools import TOOLS

MIN_LENGTH = 30


def test_every_tool_has_a_real_description():
    short = {t.id: t.description for t in TOOLS.values() if len(t.description.strip()) < MIN_LENGTH}
    assert not short, f"tools without a description of at least {MIN_LENGTH} characters: {sorted(short)}"


def test_descriptions_are_single_sentences_ending_in_a_full_stop():
    for tool in TOOLS.values():
        assert tool.description.rstrip().endswith("."), tool.id
        assert "\n" not in tool.description, tool.id


def test_description_reaches_the_client_in_the_tool_list():
    from pliable.server import Session

    reply = Session().handle({"type": "list_tools"})
    sent = {t["id"]: t["description"] for t in reply["tools"]}
    assert sent == {t.id: t.description for t in TOOLS.values()}

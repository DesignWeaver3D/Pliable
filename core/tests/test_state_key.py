from build123d import Box

from pliable.document import Document


def test_state_key_changes_with_each_edit_and_comes_back_on_undo() -> None:
    document = Document(Box(10, 10, 10).wrapped)
    start = document.state_key
    document.commit(Box(10, 10, 20).wrapped)
    edited = document.state_key
    assert edited != start
    assert document.undo() and document.state_key == start
    assert document.redo() and document.state_key == edited


def test_an_edit_after_undo_gets_a_key_never_used_before() -> None:
    document = Document(Box(10, 10, 10).wrapped)
    document.commit(Box(10, 10, 20).wrapped)
    first_edit = document.state_key
    document.undo()
    document.commit(Box(10, 10, 30).wrapped)
    assert document.state_key != first_edit


def test_two_documents_never_share_a_state_key() -> None:
    one = Document(Box(10, 10, 10).wrapped)
    other = Document(Box(10, 10, 10).wrapped)
    assert one.state_key != other.state_key

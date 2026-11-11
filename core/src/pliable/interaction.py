"""The body interaction setting: whether a tool that touches other bodies works on "this" body or on "others" too.

The app may send `interact` ("this" or "others") with a tool request; it is kept on the topology as `topology.interact`
(like `hidden_bodies`). The core decides the value that applies and reports it back (`report`). "this": only the bodies
that own the selection are used (merged, cut); "others": those and every visible, unlocked body. A loose sketch region has
no body, so only "others" is offered for it. New body mode ignores the setting. See body_scope.py.
"""

from .body_scope import _loose_faces
from .ops import solids_of

CHOICES = ("this", "others")


def loose_region_selected(topology, selection) -> bool:
    """Whether a selected face is a loose sketch region (it belongs to no body)."""
    if not selection.faces:
        return False
    loose = _loose_faces(topology, solids_of(topology.shape))
    return any(topology.face(i).IsSame(f) for i in selection.faces for f in loose)


def effective(tool, topology, selection) -> tuple[str, list[str]] | None:
    """(value that applies, choices on offer) for `tool`, or None when the tool has no setting."""
    if tool.interaction is None:
        return None
    try:
        if loose_region_selected(topology, selection):
            return "others", ["others"]
    except KeyError:  # a selected id that does not exist: the run reports it
        pass
    asked = getattr(topology, "interact", None)
    return (asked if asked in CHOICES else tool.interaction), list(CHOICES)


def strict(tool, topology, selection) -> bool:
    """Whether the tool is given only the bodies that own its selection."""
    found = effective(tool, topology, selection)
    return found is not None and found[0] == "this"


def report(tool, topology, selection) -> dict | None:
    """The `interact` field of a reply, or None for a tool without the setting."""
    found = effective(tool, topology, selection)
    return None if found is None else {"value": found[0], "options": found[1]}

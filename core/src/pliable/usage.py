"""Local tool-usage counts for GUI planning.

Counts how often each tool is started, committed, cancelled or fails, and which
surface started it. Kept in memory only, and leaves the machine only inside the
diagnostics report the user chooses to copy. To remove the feature: delete this
module, the `usage_event`/`usage_clear` requests in server.py, the `usage` key in
the diagnostics report and app/src/usage.ts.
"""

import re

EVENTS = ("start", "commit", "cancel", "error")
SURFACES = ("strip", "search", "drawer", "keys", "drag", "other")
_TOOL_ID = re.compile(r"^[a-z0-9_]{1,40}$")


class Usage:
    def __init__(self):
        self.tools: dict[str, dict] = {}

    def record(self, tool: str, event: str, surface: str | None = None) -> None:
        """Count one event; unknown names are ignored so a bad client cannot grow the table."""
        if not isinstance(tool, str) or not _TOOL_ID.match(tool) or event not in EVENTS:
            return
        if len(self.tools) >= 200 and tool not in self.tools:
            return
        row = self.tools.setdefault(tool, {e: 0 for e in EVENTS} | {"surfaces": {}})
        row[event] += 1
        if event == "start":
            key = surface if surface in SURFACES else "other"
            row["surfaces"][key] = row["surfaces"].get(key, 0) + 1

    def clear(self) -> None:
        self.tools.clear()

    def report(self) -> dict:
        return {tool: {**row, "surfaces": dict(row["surfaces"])} for tool, row in sorted(self.tools.items())}

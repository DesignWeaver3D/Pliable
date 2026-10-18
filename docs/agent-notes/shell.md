# Agent notes: shell (branch agent/shell)

Sessions: S39, S40, S13. Not edited: docs/progress.md, docs/questions.md.

## S39 usage tracking: Done (pending merge)
- Core `usage.py` (in-memory counts), requests `usage_event` / `usage_clear`, `usage` in the diagnostics report; frontend `app/src/usage.ts`, hooks in `main.ts`, `toolpanel.ts`, `alpha.ts` (report section, Clear usage counts button, launch notice paragraph). Docs: known-limitations, protocol, watchlist.
- Decisions: counts kept in core memory, not on disk (simple, nothing persists); a "drag" surface was added beside strip/search/drawer/keys because direct drags are a start path; sketch tools not counted (outside this session).
- To remove: see the header of `usage.py`.

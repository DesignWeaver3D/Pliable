# pp-core notes

Status: done (protocol, auto rule + flip, modes, ghost, tests). Full core suite 680 passed.

Protocol: docs/dev-notes.md "Push/pull modes and ghost". Request `mode` (auto/add/subtract/new), `flip`; preview reply `ghost` header {triangles, bounds} + buffers ghostPositions/ghostNormals/ghostIndices; preview reply `notice` string when a subtract removed nothing (the preview then returns the unchanged model, a commit raises).

Code: core/src/pliable/pushpull_modes.py (rules, loose regions, new bodies), ghost.py (ghost shape and buffers), ops.py (OpResult.cutters/ghost/notice, mode/flip args), tools/push_pull.py (bind and run), server.py/handlers/tools.py/protocol.py (reply). Tests: core/tests/test_push_pull_modes.py.

Decisions (also in decisions-log.md): preview no-op returns notice instead of an error; symmetric loose region no longer fills both sides in auto (test_symmetric_push_pull.py changed; mode "add" restores it). To change: pushpull_modes.py.

Frontend to do: send mode/flip, draw ghost as translucent red, show `notice` in the status line.
Resume point: nothing open in the core.

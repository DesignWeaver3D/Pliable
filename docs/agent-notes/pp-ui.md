# pp-ui notes

Status: tasks a to f done on branch agent/pp-ui (merged agent/pp-core docs commit; its contract matched the assumption: params mode string and flip bool inside params, ghost in the preview reply header plus ghostPositions/ghostNormals/ghostIndices buffers).

Files: pushpullstate.ts (mode, flip, symmetric, Alt, roles), pushpullcard.ts (card DOM), pushpullwire.ts (card to view), pushpullcolors.ts, pushpullarrows.ts (red mirrored arrow), ghostbuffers.ts and subtractghost.ts (ghost), edits in itemdrag.ts (Alt, params, card open), viewport.ts, manipulator.ts (pushPullRest colour), pullgizmo.ts (tilts, setTilts, onFrame), pulldir.ts (onReset), modelview.ts, client.ts, main.ts, index.html (#ppcard).

Decisions: see docs/decisions-log.md last line and watchlist.md.

Face cycling at press: already not done by the press path (viewport.ts pointerdown uses pickHit; pickCycling only runs in clickOrProfile on a click), so Alt held before a press that starts a drag does not cycle; Alt+click without a drag still does. No code change was needed and it needs a browser to test (not unit-testable).

Owner must hand-check (a test cannot decide):
- Alt tap/hold during a real drag: mode switches to New body and the preview changes, release restores; no browser menu focus.
- The red ghost look (35% red, outline) with a real subtract through empty space (not seen: the core part was not in this branch).
- Typed distance in the card then Apply; card closing behavior after commit.

"When X, Y happens" candidates for behavior.md:
- When a push/pull drag starts or the Push/Pull button is clicked, the Push/Pull card opens under the nav cube group; the Mode buttons Auto, Add, Subtract, New body highlight the current mode like Pick plane.
- When Alt is held during a push/pull drag, the mode is New body; releasing Alt restores the chosen mode; the state at release decides.
- When Flip is on, the arrow on the normal side is red (subtract) and the arrow on the opposite side has the add colour.
- When the card's tilt or direction fields are typed, the gizmo arrow follows, and the gizmo drags update the fields.

Verified in Chrome (port 5202): card opens with the button, Auto highlighted, Flip swaps arrow colours, typed tilt 30 tilts the arrow and shows direction 0.5,0,0.866, typed distance previews with the pre-merge core, Close cancels it. Not verified: Alt (browser tool cannot hold modifiers in a drag), ghost drawing.

Resume point: nothing pending except merging pp-core code and looking at the ghost with a real subtract; if the core's request field placement differs from params, change toolRequest in itemdrag.ts.

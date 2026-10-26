# Hand-test pass, agent status (2026-10-26)

Status per bullet of "Problems noted on the first hand-test pass".

1. Open STEP warning / add-to-session: already fixed earlier (see progress row); not re-worked.
2. Export STEP dialog: already fixed earlier; not re-worked.
3. Click select, shift select: fixed the unclear part only. Holding Shift with a selection now shows a hint line (Shift+click adds; then pick a tool or chip). Hard-to-hit edges and small faces not reproduced in a targeted way; the pick ranges already shrink for small faces. Still open for a real-mouse check.
4. Double-click chain: the chain counted two edges leaving a vertex in the SAME direction (a cusp) as smooth because the test used the absolute dot product. Fixed with outward tangents (test added). Ctrl+double-click now adds the chain to the whole selection (it dropped selected faces and bodies). Chain cases beyond that were not reproduced.
5. Related-face chips: chips already carry tooltips; the Shift hint now points to them. No new behavior.
6. All edges vs Edge loops: already fixed (face helper "Outline edges" is the outer loop only, edge helper keeps "Edge loops"; core test test_outer_loop_leaves_out_holes). Seen in Chrome.
7. Measurement stops working: cause found. A drag left open when measure mode was exited after the button was released kept viewport.dragging true, which blocks the measurement card (and the single keys) until reload. The next pointer move with no button down now ends such a drag. Checked in Chrome with a simulated sequence; the card shows afterwards.
8. Push/pull: right-click measure no longer exists (right-drag orbits); M stays the key, now explains when it cannot start and works before the pointer moves. Hole face push/pull: not reproduced on the bracket (wall hole enlarges in Chrome, core test exists). Likely remaining cause: holes whose cylinder is split into two faces have no centre record, so no drag direction, so a box selection starts; or a press on the thin rim edge. Left open for a real-mouse repro on the owner's model.
9. Delete face / Defeature: already named Defeature with refusal messages (test exists); added a catch so a kernel exception also becomes a message.
10. Align face: already has a tooltip saying it needs two parallel flat faces; unchanged.

Real-mouse-only checks: M pressed immediately after pressing a face; hole push/pull on a model with split cylinder faces; Ctrl+double-click on an edge with faces already selected.

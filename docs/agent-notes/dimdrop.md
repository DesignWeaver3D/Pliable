# dimdrop agent notes

Done: both rows built and committed locally (drop lists on the constraint row; gizmo/click-away rule).

Decisions
- Drop lists are a small arrow button beside Dimension and Horizontal / vertical (opens a menu under it); the four grouped options keep their labels and hotkeys (H, V binding unchanged).
- Click-away rule lives in app/src/toolclickaway.ts; main.ts setSelection ignores non-empty selections while a card or array form is open and restores the viewport selection. The viewport does not start another item's drag tool while a card is open (toolOpen hook).
- Array forms also follow the rule (only empty space asks apply or discard).

Human-only checks
- Real-mouse feel of the small arrow beside Dimension / Horizontal / vertical at narrow window widths (row wrapping may separate arrow from its button).
- With a card open, pressing and dragging another unselected item only selects nothing and starts no drag; confirm that feels right on tools with several handles (Move/Rotate, Resize chamfer).

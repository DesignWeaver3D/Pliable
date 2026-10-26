# Cut plane agent notes

Task 1 (Cut with plane): built. Origin plane and kept sketch buttons, Side 1 / Side 2 coloured via preview header `sides`, plain list labels. The existing arrow and tilt rings are the gizmo.
Hand-check (real mouse): drag the arrow and rings in the Cut with plane form; pick a sketch button on a document with a kept sketch.

Task 2 (chamfer): built as the Two distances button (Fillet/Chamfer form). Verified in Chrome: Edit last on a chamfer shows the button; it opened Chamfer (two distances) on a face. Real-mouse check: with several edges of one face the reference face may not border every edge (the tool then reports it).

Chamfer follow-up: Two distances chip while Fillet/Chamfer is armed; multi-edge selections fall back per edge. Chrome-checked with five edges. Real-mouse: which side is first for fallback edges.

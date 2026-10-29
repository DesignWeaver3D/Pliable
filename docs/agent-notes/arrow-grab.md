# arrow-grab notes

Status: done. The red mirrored push/pull arrow is grabbable.

What changed: Manipulator.hit also tests the red arrow's segment (anchor to anchor minus direction * arm length, helper in app/src/pushpullhit.ts). A hit returns the push/pull item, so hover (highlight, "Push/pull value" label, grab cursor) and the face-press drag (viewport.ts beginItemDrag with the handle's own direction) are unchanged code paths. The distance is measured along the face normal, so dragging out along the red arrow gives the opposite sign with no extra code; Flip works because the sign comes from the same path. A press never reaches orbit or face picking because the handle branch returns first.

Decisions: no separate item or drag for the red arrow (copy the normal arrow's path). Hovering the red arrow highlights the normal arrow (the same handle), not the red one. To change: Manipulator.hit.

Checked in the app: hover over the red arrow shows "Push/pull 0 mm"; dragging it down removed material (subtract) and Undo restored it. Not checked: the card's number during the drag, Escape cancel, Flip, typed value from the red arrow.

Hand-check: the red arrow shows its own hover highlight? (currently the normal arrow lights up); Flip then drag the red arrow.

behavior.md candidates: When the red mirrored arrow of push/pull is hovered or dragged, it acts as the push/pull arrow, and dragging along it moves the face the opposite way.

Resume: nothing open.

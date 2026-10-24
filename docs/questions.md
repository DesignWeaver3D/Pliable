# Questions for the owner

Only real questions that need your answer. Each one ends with a question mark and gives two sentences of context, the options, and what I will do if you do not answer. Decisions already made live in docs/decisions-log.md; plan changes live in docs/progress.md.

## Open questions

1. Should an array keep its settings (count and spacing) so you can edit it later, or stay plain separate solids as it is now? Arrays make separate solids today; storing the settings means a hidden record that any face edit would end, and a third option is an array that stays one compound with its source. Options: plain solids, a stored recipe that a "separate" command restores, or a compound. Default: plain solids until you answer.
2. Should a push/pull be able to run "up to" a chosen face or plane, and all the way through ("full pull")? Today you drag or type a distance and the far-face snap only helps a through-cut when the profile is fully covered. Options: add Up To and Full Pull as reference picks on push/pull, or keep typed distances only. Default: keep typed distances only.
3. Should a relationship (for example "these two holes stay coaxial") be lockable so that it is re-checked after every edit, or should everything stay re-detected on each edit? A lock would remember the faces and could go silently stale after a complex edit, which is the risk. Options: soft locks with a warning when one is lost, or re-detect only. Default: re-detect only.
4. After you edit a part that has fillets, should the fillets be removed and re-added around the edit automatically, or only when the edit fails? Re-adding saves a manual step but can change a rounded edge you did not mean to touch. Options: automatic "round last", or only on failure. Default: only on failure.

5. Should the smart dimension menus also offer Radius for a circle, Coincident for separated points, and Parallel, Perpendicular or Angle for two lines, so the matching discrete constraint buttons can be removed? Those buttons stay today because some selections have no smart route, which keeps two ways to do the same thing. Options: add the choices and remove the buttons, or keep the buttons as they are. Default if unanswered: keep the buttons.
6. What exact steps show "sketch face extrusion by the pull gizmo didn't get registered in undo"? Undo and redo worked in every case tried; the only gap found was that one Undo left the picked loose face behind, now fixed so a single Undo removes both. Default if unanswered: treat it as fixed.
7. Should `sketch.ts` (about 1860 lines) and `main.ts` (about 1450 lines) be split into modules now? The commit hook flags both, and the architecture plan holds the order and risks. Options: split now with a Chrome check per slice, or keep adding features first. Default if unanswered: keep adding features, no split.
8. Should a wall's draft angle be editable in place again? The ∠ tag on an upright wall was the only in-place way to change its draft angle, and it is hidden now so that no face angle shows over the push/pull gizmo; the Draft tool (a face selected, then Draft) still does the same edit through its card. Options: leave it to the Draft tool, show the tag only while the Draft tool is armed, or add an angle entry to the push/pull card. Default if unanswered: leave it to the Draft tool.

The other open questions in the research notes (hotkey letters per tool, plain Delete on a selected face, a repeat-last key, drag-only versus gizmo-first, blocking versus hint for fillet order) are listed in docs/future-ideas.md; none of them blocks work.

## Topics you asked to discuss one at a time

These are not questions yet; I will turn each into specific questions when you pick it: keyboard shortcuts (which modifier combinations, which keys are reserved and why, where the pointer must be), the sketch keys, and the unsaved-work warning.

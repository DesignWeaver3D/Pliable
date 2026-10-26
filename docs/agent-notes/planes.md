# Planes agent notes

- Cut with plane: Plane: 3 points, Plane: edge + point and Plane: face offset/angle added (app/src/planebuild.ts; host pickItem and planeFrom in main.ts). Chrome check: face offset 3 on the top face moved the plane and the preview cut.
- Choosing the half by two special colours: already covered by the coloured Side 1 / Side 2 names; dropped.
- Real-mouse-only checks: 3 points and edge + point pick sequences (Esc mid-sequence cancels; the status line prompts each pick); angle other than 0 with the face button.
- Edit cut: Length and Width resize (core/src/pliable/void_stretch.py, tools/edit_void.py), tested through Tool.execute and handle_list. Not checked in Chrome (no square cut in the test data): drag the two new grips on a square or slot cut and confirm the ends move with the mouse, with the all-round grip still working.

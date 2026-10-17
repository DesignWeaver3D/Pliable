# Questions for the user (overnight session, 2026-10-17)

Decisions were made with this order: your described workflow, industry standard, common practice in other direct modelers, web consensus. Each entry: what I decided, why, and what to change if you disagree. Development did not stop for any of these.

1. **Orthographic mode** is a perspective camera with a 0.5 degree field of view moved far back (keeps all picking code unchanged). Industry standard behavior is a true orthographic camera; switch if you see depth-precision or picking problems.
2. **View keys:** Number keys for standard views (0 iso, 1 front, 2 top, 3 right, 4 rear, 5 bottom, 6 left), P toggles perspective/orthographic, V looks at the selected flat face.

# Surfaces agent notes

Task 1 (menu button): done, cc36abd. #menubtn reads PLIABLE (hamburger icon from main.ts), orange tag style, ALPHA tag removed.
Task 2 (app store): done. `app/src/meshstore.ts` + `app/tests/meshstore.test.mjs`. Not wired into `CoreClient`; protocol unchanged.
Resume: core part (BodyData.rev, assemble parts, Session.sent, delta encoding, hello opt-in, full_mesh request) after the speed branch merges; then wire `MeshStore.apply` into `CoreClient.onMessage` (apply every delta before resolving; on `needFull` request a full reply).

## Delta shape (TypeScript, in meshstore.ts)

    MeshDelta { version: number; base: number | null; bodies: DeltaBody[]; bounds: number[]; header: Record<string, any> }
    DeltaBody { id; rev; faces; edges; vertices (counts); info (the full reply's bodies[] entry); data?: BodyPayload }
    BodyPayload { positions, normals, indices (local to the body's points), edgePositions: typed arrays;
                  faces[{start (local, index entries), count, normal, centroid}];
                  edges[{start (local, points), count, normal, centre?}];
                  vertices[{position}]; centres[{face (local), position, axis, length?}] }

- Every body is listed in model order on every reply; `data` only when the page does not hold it at that `rev`.
- `base` is the previous reply's `version` (core `sent`); null = builds on nothing, every body carries `data` (this is the
  full reply). `header` holds the rest of a full header (canUndo, sketches, datums, ...); faces/edges/vertices/centres/bodies/bounds
  are rebuilt by the store. Ids: face/edge/vertex = summed counts of earlier bodies + local number; `solid` = position; `body` = id.
- The wire encoding of the payload buffers (offsets in the binary frame) is for the core commit to define; the store takes decoded typed arrays.
- On base mismatch, a body not held at its rev, or counts not matching the data, `apply` clears the store and returns `{ok:false, needFull:true}`.

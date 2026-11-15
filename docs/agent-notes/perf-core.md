# perf-core: where the time goes in the app (measurement only)

Dev tools added: `?dev=1&nocompare=1` writes `[perf]` lines (devtiming.ts) and `window.__timing.step(name)` / `.endStep()` totals; `/__dev_file?path=` on the Vite dev server (vite.config.ts, dev only) lets a test tab load a local model file. `nocompare=1` is needed: dev mode otherwise sends an extra whole-model request after every commit.
Enclosure on port 5202/8802, 164k triangles. Real clicks via the browser tool; gizmo drag by a real drag (down/up only, no mid-drag previews, moved about 0), typed values via the form.

Per step (ms; core = core's own time when the reply has one):
- Import: 33.0 s round trip, core 27.2, decode 34, apply 20; 1.3 s page task (base64 of 27 MB); first frame after it 1.0 s.
- Face click (run 1 with merge possibly running, run A after it): about 2.5 s. Page 0.3-0.4 s before sending (two long tasks of 60-110 ms), then SIX requests in two bursts (related, available_tools, measure, each twice, 20 ms apart); the core answers one at a time (related 0.8 s, available_tools +0.2, measure, then the second burst +0.8 s), tool_handles is sent only after (at +2.1 s) and answers in 60 ms.
- Select parent body: 0.3 s, 3 small requests (60 ms).
- Arm Move/Rotate: usage_event + tool_preview (core 0.29-0.38 s, reply 56 KB delta at first; 11.2 MB whole reply once a real move had happened); then 0.2-0.9 s wait for the first frame and a 1.0 s frame: gizmos about 2.0-2.6 s after the click.
- Typed move (preview, first one after the arm): core 16.8 s (11.5 MB reply), then 5.0 s, then 4.2 s on later ones (replies 3.3 MB, 0.3 MB).
- Apply (tool_commit): core 2.4 / 1.5 / 0.7 s, reply 12.5 MB whole model every time (decode 14-23 ms, apply 11-15 ms); 4 small requests after; frame wait 0.7-0.9 s + frame 1.0 s. Run 3: the Apply queued behind the 16.8 s preview (round trip 16.7 s).
- Gizmo drag with down/up only: tool_commit core 0.35-0.54 s, 0.4 s of page work before it, then frame 0.3-0.4 + 1.0 s; about 2.3 s.
- Every redraw of the 164k-triangle model costs about 1.0 s "frame" (and 0.2-0.9 s before it) that is not JavaScript: setMesh 3-12 ms, a render call 13 ms, steady render 1 ms. It is GPU upload and draw or compositing, on every show, previews included.
- Background import merge: import finished at page time 37 s; the first face click was at 49 s (probably still merging, about 15 s), run A at 73 s (merged). The face click cost was the same in both, so the merge did not change it here.

Biggest costs, in order: the typed-move preview (5-17 s core) and the Apply (0.7-2.4 s core plus a 12.5 MB whole reply); the per-show 1.0 s frame; the duplicated and serialized face-click requests (2.1 s); replies are whole models (11-12 MB) after the first real move, not deltas.

Recommended order (no fixes made): 1) why a move preview and a commit take 0.7-17 s in core and answer with the whole model; 2) the 1.0 s frame after each show (upload only changed bodies, or one geometry per body); 3) send each face-click query once and ahead of the unneeded ones (related/measure/available_tools twice; tool_handles waits for them); 4) page work before a request (0.3-0.4 s).

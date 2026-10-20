# sketchstore status

Core side of persistent sketches is done: Document keeps per-state sketches and a never-reused id counter,
autosave meta has "sketches" and "sketch_next" (old autosaves load), Session handles sketch_keep, sketch_get,
sketch_delete, sketch_rename, mesh headers carry "sketches". Open paths are kept; facesMade reports faces added.
Tests: core/tests/test_sketch_store.py (380 pass in total).

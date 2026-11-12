# facemerge agent notes

Done: `core/src/pliable/samesurface.py`, called from `unify_result` (not on drag previews). Tests in `core/tests/test_samesurface.py`.
Also fixed: when the kernel merge gave an invalid shape, the fallback reused the copy the merge had changed; it now copies again.

Owner judgment: look at a model with a bore made from the other end.

Resume: nothing open. Possible follow-up: a sphere or torus group with a hole in it is untested; merge only near the change if large models get slow.

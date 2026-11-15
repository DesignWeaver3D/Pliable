# perf-core notes (branch agent/perf-core)

Scripts (outside the repo): C:\dev\pliable-wt\perf\memo_commits.py (task 1), phase2.py (phase timings of arm, previews, commit).

## Task 1: carrying the merge memory across a commit
20 varied commits on the enclosure as imported (move, rotate, push/pull, hole in turn, random bodies/faces), after each the whole-model merge
(`finish`) compared with the committed model (face/edge/vertex counts, per-body counts, area, box), and the same per body alone.
- Enclosure: 1 of 20 changed. The first commit after the import (a move): the whole merge still removed 6 edges and 6 vertices
  (bodies 0 and 110, 2 edges and 2 vertices each... totals 18745 -> 18739 edges, 12258 -> 12252 vertices). The merge had not settled
  after the per-body background merge plus the move. Commits 2-20: merge changed nothing, whole and per body alike.
- Test-suite multi-body model (test_bgmerge.model_file, 4 bodies, same 20 commits): 0 of 20 changed.
- Decision: it sometimes changes, so the memory is NOT carried over a commit (rule from the task). The one case is a model not yet
  settled; carrying only from a starting model with `merged` true might be safe but is not proven by this data.
- Where the 3.6-4 s moves come from: after push/pull or hole the result has `merged` False, so the next move merges the whole model
  (3 s). After a move or rotate `merged` is True and the next move takes 0.7 s.

## Tasks 2 and 3: display
Phase timings (enclosure as imported, waited for the background merge):
- Arm (zero preview) was 4.0 s: every body's preview-keyed display data was missing (the import reply stored the non-preview data).
  A preview and the full display of a body differ only in the edges' drag directions, so body_data now makes one from the other.
  Arm now 0.5-0.8 s.
- First preview of a drag (3.9 s) displays the bodies the merge made (faces merged, so counts and triangulations really differ from
  the imported ones): they must be built once; not changed.
- Release (commit) was 3.3 s, 118 bodies rebuilt with edge drag directions; now the preview data is reused and only the directions are
  added: 2.2 s (1.3 s of it is the 18704 edge normal calls).

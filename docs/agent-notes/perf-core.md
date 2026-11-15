# perf-core agent notes

## Task 1: merge memory carry-over (04ef7a2)
- `mergememo.carry_memo` called from `handlers/tools.py` after `target.merged = result.merged`, only when the start model was marked merged before the tool ran.
- Enclosure, as imported (script `C:\dev\pliable-wt\perf\pcore_t1.py`): moves 5.1/5.3/3.6 s, push/pull commit 0.59 s, first drag preview after it 0.66 s, second 0.50 s, drag commit 0.54 s. Replies 13.9 MB (12.9 MB preview).

## Resume point
Task 2 next.

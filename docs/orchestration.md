# Running agents in parallel

How the main session (the orchestrator) works with several agents at once. Use it only when the owner asks for parallel agents. Written from the first two waves; update it when a step turns out wrong.

## When it fits

- Group the open sessions in `docs/progress.md` by code area and give each group to one agent: kernel tools (`core/`), sketch (`sketch.ts`, `unwrap.py`), selection and picking (`viewport.ts`), application shell (keys, diagnostics, forms, autosave). About four agents is the practical limit.
- Hold back work that cuts across everything (the GUI rework, manipulators, anything that rearranges shared UI files) until the others are merged. Run it alone.
- Anything that waits on an owner answer stays unassigned.
- Usage is limited: check with the owner before starting a wave, and stop agents when the owner says the limit is reached.

## Setup

- One git worktree per agent, from the main checkout: `.\scripts\worktree.ps1 new <name>` makes `..\pliable-wt\<name>` on branch `agent/<name>`, gives it its own ports (core 8801+, frontend 5201+), its own autosave folder (`PLIABLE_DATA`), and copies the ignored project files. `list`, `remove <name>` and `refresh <name|all>` are the other actions.
- Ignored files (the agent rules file in the repo root, `docs/research/`, the local settings file) are not part of a checkout. **Before starting or resuming any agent run `.\scripts\worktree.ps1 refresh <name|all>`, then merge `main` into the agent branch.** Otherwise the agent reads stale rules.
- The local settings file asks before any `git push` and denies `git update-index`. `.gitattributes` keeps both sides of `docs/watchlist.md` on merge.
- Fresh agent or resumed agent: resume only when the next task touches the same code; otherwise start a fresh agent with the task and the relevant progress rows. A resumed agent re-reads its whole history on every turn, so long histories cost usage.
- Research agents use the `researcher` agent definition (cheap model, no file edits).

## The prompt every agent gets

Name the worktree and branch, then require, in this order:
1. Use absolute paths under its worktree; never touch the main checkout or other worktrees.
2. Read the agent rules file in the repo root, `docs/progress.md`, and the relevant `docs/questions.md` and `docs/decisions-log.md` entries.
3. Its ports and the exact core server line with `PLIABLE_DATA` (from `agent-ports.txt`); never port 8765.
4. Finish one task at a time: run the tests and commit that task (one commit per task, plain subject) before starting the next, so a cutoff loses only the task in progress. Local commits on its branch only; never push; no `git update-index`; do not touch `dev`, `rebuild` or `main`.
5. Do not edit `docs/progress.md` or `docs/questions.md`; put status, decisions (with what to change), open questions and the resume point in the final report and in a temporary `docs/agent-notes/<name>.md` on its branch; watchlist entries append-only.
6. Commit messages pass `scripts/check_commit_message.py`; the hook also rejects names of other products and AI tools in any staged text, so describe behaviour instead.
7. Unattended rules from the agent rules file: decide, log, keep going; ending the turn ends the run.
8. Tests go through the real code path (`Tool.execute` or the server handlers, never helpers that skip steps the app applies); run core tests, `npm test`, `npx tsc --noEmit` and `npm run build`.
9. Verify its own work in the running app in Chrome on its own ports: exercise the real feature, undo every change, avoid dialogs. Its final report lists what it checked in the app and what it did not. Keep the browser check cheap: one targeted check per user-visible change (not per sub-step), take screenshots at scale 0.5 and zoom into the region of interest instead of full-size shots, prefer reading the page text, console messages or element titles when they answer the question, and take no more than about six screenshots per task.
10. No runaway processes and no background commands; every command finishes within about two minutes.
11. Clean up when finished: stop its own servers and close its own Chrome tabs; never touch the owner's test tab or servers.
12. Final report under 150 words: done or parked, commits, test counts, checked and not checked.

## Keeping usage low (owner request 2026-10-19)

- **Fewer, smaller agents:** one agent per code area at a time. Related new tasks go to the agent already working there by message (SendMessage), not to a new agent. Do not start a second agent for work in the same files.
- **Right-sized tasks:** give an agent only the tasks it needs now, with the files to read named, so it does not explore the whole repo; tell it to read excerpts, not whole large files (`main.ts`, `viewport.ts`, `features.py`).
- **Cheap verification:** the browser check rule in item 9; unit and Session.handle tests carry most of the verification, the browser only confirms that the feature is visible and usable.
- **Orchestrator:** no re-tests for a single clean agent merge (only when several concurrent branches are merged or a code conflict was resolved); no re-reading of agent transcripts; reports stay under 150 words.
- **Model:** agents run on the cheaper model (sonnet); research agents use the researcher definition.

## While the owner is testing (2026-10-19)

The owner's page on 5180 is served from the main checkout, so any edit there reloads it mid-test. Do all edits in worktrees and merge into `main` only on request; run worktree checks on spare ports; a `scripts/worktree.ps1 new <name> -Base <branch>` starts from another branch (used to stack agents on an integration branch). To test several agents' work together, merge their branches into a scratch integration worktree first (resolve the usual `docs/decisions-log.md` and `docs/watchlist.md` append conflicts by keeping both sides), run all checks there, and merge that one branch into `main`. Run `scripts/worktree.ps1` through Bash (`powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/worktree.ps1 ...`): the PowerShell tool aborts it on git's stderr output.

## Spot-checking

Never merge on a report alone. In the agent's worktree run the core tests, `npm test` and `npx tsc --noEmit`, and read the commit list. For a UI change, check one claim in Chrome yourself. A report that says the Chrome check was skipped goes back to the agent.

## Merging

- Merge finished branches into `main` one at a time, running core tests, `npm test`, `tsc` and `npm run build` after each. Do not push unless the owner asks.
- Expect conflicts only in shared UI files (`main.ts`, `viewport.ts`, `toolpanel.ts`, `sketch.ts`, `keys.ts`). Read both sides; features added in two branches may need a hand merge (for example a key re-added to the router).
- If the owner is testing in the main checkout, ask before merging: the frontend reloads live while the core server keeps old code, which can break their session. After merging, restart their test instance and tell them to reload.
- Afterwards: fold the notes into the plan (`docs/progress.md` rows), log decisions in `docs/decisions-log.md`, and put only real questions in `docs/questions.md`. Then delete the agents' temporary notes files; do not keep them in the repo.

## Orchestrator's own checks

Run the merged build on spare ports (for example core 8770 and frontend 5180 or 5181) with an empty temporary `PLIABLE_DATA`, in its own Chrome tab; stop the servers, remove the temporary folder and close the tab when finished. Drag actions with a modifier key do not apply the modifier in the browser tool, so a drag over a face is a push/pull.

## Known pitfalls

- Tests calling `Tool.run` pass while the app (which uses `Tool.execute`) is broken.
- All instances share one autosave folder unless `PLIABLE_DATA` differs (the app now also uses a folder per running copy).
- Skip-worktree patches block later merges; do not use them.
- A research agent's background check once kept a process running for nearly an hour; agents must not start background commands.
- Closing a Chrome tab can hang on a leave-site prompt while edits or a sketch are open; undo and discard first.
- If the browser tool loses its tab group, the remaining tabs must be closed by the owner.

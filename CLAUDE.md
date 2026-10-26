# Working on Pliable with the AI assistant

Pliable is being rebuilt; `main` is the development branch. Contributors change it by pull request, the owner commits to it directly, and releases are tagged from `main` or a `release/*` branch (see CONTRIBUTING.md). The plan is in [ROADMAP.md](ROADMAP.md); open work is in [docs/progress.md](docs/progress.md), and lasting technical notes are in [docs/dev-notes.md](docs/dev-notes.md). Finished work is not recorded in a file: it lives in the commit messages (`git log --grep`).

## Starting a session

The steps below apply to interactive sessions. In an unattended session (see "Unattended sessions") the queue is every open row, and that section overrides any rule here or below about scope or stopping.

1. Read `docs/progress.md`. Don't re-read or re-explore anything it already records.
2. Take the first open row in the plan (not Parked). Work only on that row; if something else comes up, add it to the plan instead of doing it. Rows have no numbers; the title identifies them.
3. If a row has an "In progress" note, resume from it exactly.
4. New rows quote the owner's request in their own words and list what it needs as a checklist. Never paraphrase the request. A row is deleted only when every checklist item is verified against the quote.
5. Keep `docs/progress.md` open work, parked work and not-built ideas only, under about 20 KB (a pre-commit check blocks more). Before adding a row, search its Parked and Ideas sections for related items and say which ones the new row touches. When work is finished, delete its entry (git keeps the history) and describe the change in the commit message; do not write session narratives, summaries or numbered labels in any file or commit.

## Protecting existing behavior

Most of the owner's lost time comes from regressions and from invented design, not from missing features. These rules apply in every session.

- **Read the behavior record first.** Before editing an area, read its section of [docs/behavior.md](docs/behavior.md) and the matching entries in `docs/decisions-log.md`. Everything in `behavior.md` was approved by hand and is a requirement.
- **Fix only what was asked.** Change the reported bug and nothing around it. Do not alter visible behavior, layout, defaults, key bindings or wording outside the stated goal, and do not tidy or refactor nearby code in the same change.
- **Copy the existing pattern.** Before adding or changing anything, find the nearest similar feature (another tool, handle, card, key) and do it the same way, using the same helpers and naming. Do not introduce a new strategy, abstraction or UI pattern unless the owner asked for it.
- **Read what you edit.** Read the whole function and its callers (grep for them) before changing it, even if the task is small; excerpt reads are not enough for shared handlers in large files (`sketch.ts`, `viewport.ts`, `main.ts`).
- **When a fix seems to need a behavior change, stop and ask.** In an attended session, ask the owner (see "Deciding without the owner" for the unattended case only). "Discuss" means no edits.
- **Check what the diff touched.** Before committing, read `git diff` and confirm every changed line serves the goal; mention anything that changes behavior in the commit body and in the report.
- **Record approvals.** When the owner approves or corrects a behavior, add a one-line "when X, Y happens" to `docs/behavior.md` in the same commit. When the owner reports a hand-test item passed, delete its line from `docs/testing-checklist.md`; a failure becomes a row in `docs/progress.md`.
- **Add a test for a fixed regression** when it can be tested without a browser, so it cannot return.
- **Before a release, follow the release checklist in [CONTRIBUTING.md](CONTRIBUTING.md);** documentation is finished before the tag.

## During a session

- **Keep code modular.** Before adding a file or code, read "Where code goes" and "Keeping code modular" in [CONTRIBUTING.md](CONTRIBUTING.md): one job per file, new behavior in a new file named for its job (not appended to `main.ts`, `sketch.ts` or `viewport.ts`), shared helpers in a shared module. When the commit hook prints a long-file note for a file you touched, check whether it mixes jobs and, if so, raise it with the owner and add a Planned row; line count alone is not a reason to split.

- Usage is limited (a subscription plan). Keep context small: read only the files the task needs, keep command output short, and don't dump large files.
- Use subagents only when clearly cheaper than doing the work directly, and give them a cheap model: the `searcher` agent (Haiku) for lookups, the `researcher` agent (Sonnet) for research.
- Commit to `main` after every working step, with tests passing. Push only when the owner asks (a permission rule asks before any push, and agents never push). Never commit failing tests. Never tag, create a release branch or open a pull request without the owner's say.
- **Changing this file.** You may propose changes to this file, but only apply them after the owner has seen the exact diff and explicitly agreed to it in this conversation. Approval of one change does not extend to another.
- **If you are working for a contributor rather than the owner,** "the owner" means the maintainer who reviews the pull request. Where this file says to ask the owner, ask the contributor, and do not edit `docs/behavior.md` without their approval.
- When adding a shortcut, tolerance, guess or known limitation, add an entry to [docs/watchlist.md](docs/watchlist.md) in the same commit, naming the commit that introduced it by short hash (add the hash in a follow-up commit if it is not known yet). The file is large: search it with Grep, do not read it whole.
- Commit messages and PR text contain no AI attribution lines of any kind.
- Commit messages are written for a human reading the log later: a plain subject (12-72 characters, capitalized, imperative, no period, no labels like `S22:`, `feat:` or `Progress:`) that says what the change does, and for any commit touching 3 or more files a short body saying what changed and why. Never name commercial products or other programs (other CAD tools, AI tools, vendors); describe the behavior instead. The hook also rejects the name of the AI tool and of its instructions file, so write "the project instructions file". Write the message once, correctly: check it against these rules before running `git commit` and never retry a commit because the hook rejected it. Commit from the Bash tool with a heredoc (`git commit -F -`); the hook finds the project's own Python by itself, so PATH does not matter. Prefer one commit per logical change, not a log entry per session step.
- Enforcement: `.githooks/commit-msg` and the `commit-lint` workflow run `scripts/check_commit_message.py`. Enable the hook once per clone with `git config core.hooksPath .githooks`. Fix a rejected message; never bypass the hook.
- Interactive sessions: stop when the row's checklist is verified, then report to the user. (Unattended sessions never stop here; see "Unattended sessions".)
- **No runaway processes.** Never start a background command that you do not stop yourself, and give every command a time limit of about two minutes (use the tool timeout or `timeout`). If a check hangs, abandon it, say it could not be verified, and stop the process. Before returning a final report, make sure nothing you started is still running (your own servers, shells and scripts); a research agent once kept a stray script running for nearly an hour after its report was done.
- **Clean up when finished.** Before returning a final report, stop your own copy of Pliable (core server and frontend dev server, found by your assigned ports) and close every Chrome tab you opened, after undoing or discarding any edits so no leave-site prompt blocks the close. Never close or stop anything you did not start; the owner keeps their own test tab and servers. State in your report that you did this, or what you could not close.

## Running agents in parallel

When the owner asks for parallel agents, follow `docs/orchestration.md`: worktrees from `scripts/worktree.ps1`, a refresh of the ignored files before every hand-off, the agent prompt template, spot-checks of every report, and the merge procedure. The orchestrator never pushes unless asked.

## Deciding without the owner

This section applies only when the owner is away or the session is unattended. In an attended session, ask the owner instead of deciding, and never override anything in `docs/behavior.md`.

When a request is ambiguous and the owner is away, decide in this order and keep going:

1. A workflow the owner has already described (check `docs/questions.md`, `docs/progress.md` and the owner requirements).
2. Industry standard practice for solid-modeling programs.
3. Common practice in other direct modelers.
4. General user consensus from the web.

Use the gathered research before searching again: `docs/research/` holds the landscape survey, tool priorities, the parity plan, the command inventory, workflow comparisons, the GUI plan and the shortcut policy. These notes are local and untracked. They are research only: take ideas, structure and behavior from them, never copy code or text from other programs. Log each decision in `docs/decisions-log.md` (a short factual record; the owner does not read it, so never log fixes, encodings or other internal details). Put something in `docs/questions.md` only if it is a real question the owner must answer: write it as a question ending with a question mark, give two sentences of context, the options and the default you will use if unanswered. Never put statements, status reports or already-fixed problems in `docs/questions.md`, and never ask something with an obvious answer. Never stop development for a question.

## Unattended sessions

When the prompt says the owner is asleep, away, or that the session is unattended, this is an unattended session. These rules OVERRIDE every other rule in this file about stopping, reporting, scoping to one session, and wrapping up. The goal of an unattended session is to run for many hours and finish everything in `docs/progress.md`.

- **The queue is every open row in `docs/progress.md`** (the Planned and Open bug sections, plus unparked rows), in order, plus any prompt-specified items first. The run is finished only when no open row remains outside the Parked section. Nothing else is a valid reason to stop.
- **Ending your turn ends the run.** A final message with no tool call stops everything and nobody is there to reply. So never write a summary, status report, "next steps" or "let me know" message while queue items remain. After finishing an item, immediately start the next one in the same turn. The only final message is the one described in "Stopping" below.
- **Not valid reasons to stop:** finishing one session or a batch of sessions; a checkpoint session; a question or ambiguity; a decision that needs the owner; a failing or skipped item; "good stopping point"; the feeling that the context is large or the session has run long (context is compacted automatically, keep going); having made a lot of progress; the remaining items being large, hard or risky.
- **Work the owner must hand-test:** do the work, append it to `docs/testing-checklist.md` as one line saying what to do and what to see, and continue. Do not report.
- **Items needing an owner decision:** decide using "Deciding without the owner", log it in `docs/decisions-log.md`, build it, append it to `docs/testing-checklist.md` and say it is provisional. Never wait.
- **Failures:** if an item fails or stagnates after a reasonable attempt (about three different approaches), write what was tried in `docs/progress.md`, move the row to Parked, and go to the next row. Never retry in a loop, and never treat one failure as the end of the run.
- **Rows with sub-parts:** a row that is partly done stays open. Finish the remaining parts, or park them explicitly with notes, before moving on.
- **If the plan seems exhausted but open rows remain,** re-read `docs/progress.md` from the top; you have missed some. If every row is truly Parked or awaiting the owner, add new rows from `ROADMAP.md`, `docs/research/` (parity plan, command inventory, GUI plan) and the "Not built" items in `docs/decisions-log.md`, and keep working. Only an empty plan with nothing left to add in any of those places counts as an empty queue.
- **Before each new item, run this check:** "Is there an open row (not Parked) in `docs/progress.md`?" If yes, start it now. If you catch yourself composing a wrap-up message, run the check instead.
- **Stopping.** Stop only when (a) the check above finds no row to work on, (b) the usage limit ends the session, or (c) you are blocked on something only the owner can do and every remaining row depends on it. Before a stop, make sure everything is committed and `docs/progress.md` says exactly where to resume. Then, and only then, put the resume point in `docs/progress.md` (the summary of what was done goes in the final message and the commits, not in a file), list any real questions in `docs/questions.md`, and write the final message.
- Do not push, tag, create release branches, run or cancel release workflows, or change settings. Do not change this file.
- Commit to `main` after every working step with tests passing (local commits survive a cutoff; do not push unless the prompt says to), and keep `docs/progress.md` current so a cutoff loses nothing. Before the usage limit hits, make sure everything is committed and the log says exactly where to resume.

## Ending a session (always, including when stopping early)

1. Run the tests.
2. Update `docs/progress.md`: delete finished rows (appending anything the owner must hand-test to `docs/testing-checklist.md`), or write an "In progress" note saying exactly what's finished, what's half-done, and the next concrete step.
3. Commit (push only if the owner asked).

In an interactive session, if it is running long or the usage window is nearly used up, do these steps right away rather than starting anything new. This wrap-up rule does not apply to unattended sessions until the usage limit is actually reached: there, do these steps after every item and keep going.

## Environment (Windows)

- Python core: `core/`, uv-managed Python 3.13 in `core/.venv`. Run `uv sync`, `uv run pytest`, `uv run python scripts/bench.py`, `uv run pliable-server` from `core/`.
- Frontend: `app/` (Node 24, Vite).
- uv and Node were installed with winget. In PowerShell, refresh PATH first if `node` or `uv` isn't found:
  `$env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')`
- OCP 8 API notes (collections module, renamed static methods) are recorded in `docs/progress.md`.
- Run npm, npx and uv from the PowerShell tool after refreshing PATH (the Bash tool has no npm; a nested `powershell.exe` from Bash cannot run npm because of the script execution policy). Check results with `Select-String '^ℹ (pass|fail)'` for node tests, `Select-Object -Last 1` for pytest.
- The owner tests on frontend port 5180 with a core on 8770 (`VITE_CORE_PORT=8770`); never stop their servers unless asked. To restart a core: stop the listener and its `uv run` parent processes, then start `uv run pliable-server --port 8770` hidden from `core/`.
- Agent worktrees, ports and the usage rules are in `docs/orchestration.md` ("Keeping usage low"); the current state and the open work are in `docs/progress.md`; lasting technical notes are in `docs/dev-notes.md`.
- Before merging for a release, follow the release checklist in CONTRIBUTING.md.
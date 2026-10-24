# Contributing

## Commit messages

Write commits for someone reading the log later.

- Subject: 12 to 72 characters, capitalized, imperative, no trailing period, no labels such as `S22:`, `feat:` or `Progress:`. Say what the change does.
- Body: any commit touching 3 or more files needs a short body saying what changed and why. Wrap lines at 80 characters.
- One commit per logical change, not one per work step.
- Do not name commercial products or other programs (other CAD tools, AI tools, vendors); describe the behavior instead.
- Files, not just messages, must not name other products. Describe behavior in our own words and do not say it follows or matches another program.

`scripts/check_commit_message.py` enforces the message rules and `scripts/check_content.py` blocks other products' names in added lines. Enable the hooks once per clone:

    git config core.hooksPath .githooks

The `commit-lint` workflow runs the same check on pushes and pull requests.

## Branches

- `dev` is where day-to-day work goes. Commit and push there as often as you like.
- `rebuild` is the release candidate. Pushing to it starts the four-platform build and smoke test, and a newer push cancels the build before it, so it only changes by merging `dev` (a normal merge, never a force-push).
- `main` is the default branch and holds the last released state. Merge `rebuild` into it when cutting an alpha.
- Version tags (`v*`) are cut from `rebuild` once its build is green. The tag build makes a draft release that you publish by hand.

## Reference material

Notes about how other tools work stay in `docs/research/`, which is ignored by git and never committed or pushed. Write them in our own words. Nothing is copied from other tools: no code, no text, no screenshots.

## Where code goes (core)

- A modeling tool is one file in `core/src/pliable/tools/`, named after the tool's id, plus one import line in `tools/__init__.py` (the list is explicit and in registration order; the packaged app only includes modules that are imported by name). Update `core/tests/tool_registry.json` with `uv run python tests/test_tool_registry.py` when a tool is added or its declaration changes on purpose.
- A helper used by two or more tools goes in `core/src/pliable/shared/`; a helper used by one tool stays in that tool's file.
- Sketch code is the `sketch/` package (solver, profiles, planes, operations); server request handlers are mixins in `handlers/`.
- A file past about 400 lines is a prompt to evaluate, not a hard limit: see "Keeping code modular" below.
- When moving code, change nothing else in the same commit, and check it with `uv run python ../scripts/check_moves.py check` (hashes of every function and method against `scripts/move_baseline.json`).

## Keeping code modular (core and app)

The aim is that new work lands in small files without a later clean-up pass.

- One job per file, named for that job. New behavior goes in a new file named for what it does, plus the one line that registers or imports it. Do not append it to the nearest large file, even when that file already has similar code; copy the pattern, not the location.
- Before adding code, ask what job it does. If it is the same job as an existing file, it belongs there; if it is a different job, it is a new file.
- A helper used by two or more callers goes in a shared module for that job (`shared/` in the core, a named helper file in the app); a helper used by one caller stays beside that caller.
- Keep a thin entry file. `main.ts`, `sketch.ts` and `viewport.ts` coordinate; the work they do is delegated to modules they import. Do not put new logic in them if a module can take it.
- When a file you touch is long (the pre-commit hook prints a note past about 400 lines), look at whether it holds more than one job. If it does, tell the owner and add a Planned row to `docs/progress.md` naming the file and the jobs mixed in it. Do not split it unasked in the same change, and do not ignore it.
- The line count is only a prompt. A long file with one clear job is fine; a short file doing three jobs is not.

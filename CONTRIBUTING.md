# Contributing

## Commit messages

Write commits for someone reading the log later.

- Subject: 12 to 72 characters, capitalized, imperative, no trailing period, no labels such as `S22:`, `feat:` or `Progress:`. Say what the change does.
- Body: any commit touching 3 or more files needs a short body saying what changed and why. Wrap lines at 80 characters.
- One commit per logical change, not one per work step.
- Do not name commercial products or other programs (other CAD tools, AI tools, vendors); describe the behavior instead.
- Files, not just messages, must not name other products. Describe behavior in our own words and do not say it follows or matches another program. The one exception is `README.md`, which may name other products to say how Pliable relates to them (inspiration, scope, the FOSS ecosystem) and carries a trademark disclaimer at the bottom; it never claims equivalence or parity. Alpha warning: the README warning becomes a beta warning at the beta milestone and is deleted at v1.0.

`scripts/check_commit_message.py` enforces the message rules and `scripts/check_content.py` blocks other products' names in added lines. Enable the hooks once per clone:

    git config core.hooksPath .githooks

The `commit-lint` workflow runs the same check on pushes and pull requests.

## Branches and pull requests

- **`main` is the development branch** and the default. It is protected for everyone but the owner: changes arrive as pull requests, and the `ci` checks (core tests, app tests and build, release documents) and the commit-message check must pass.
- **Contributors:** fork the repository, make a branch, open a pull request against `main`. Keep each pull request to one concern and fill in the template. Squash-merge keeps the history readable, so the pull request title becomes the commit subject (the commit message rules above apply to it).
- **The owner** (a repository administrator) commits to `main` directly; the protection rule does not apply to administrators. The `ci` checks still run on every push, so tag a release only from a commit whose `ci` run is green. A pull request is optional for the owner, for changes worth checking before they land.
- **Releases:** tags (`vX.Y.Z`) are cut from `main`, or from a release branch when one exists. A release branch (`release/0.4`) is only made when `main` has moved on to work that must not ship in patch releases; fixes go to `main` first and are cherry-picked to the release branch. Pushing a `release/*` branch or a tag starts the four-platform build and smoke test; a tag also makes a draft release that the owner publishes by hand.
- Do not tag, publish or create release branches without the owner saying so.

## Release checklist

Documentation is finished before the tag. `PREV` is the last release tag (`git describe --tags --abbrev=0`).

1. **Version number:** the owner picks it. The 0.4 series lasts until 1.0, so a release is normally the next patch number.
2. **Set the version** in `core/src/pliable/__init__.py`, `core/pyproject.toml`, `desktop/src-tauri/Cargo.toml` and `desktop/src-tauri/tauri.conf.json`, and in the project's own entries of the lock files: `pliable` in `core/uv.lock` and `pliable-desktop` in `desktop/src-tauri/Cargo.lock`. `app/package.json` stays at 0.0.0.
3. **Documents:** the README status line names the new version and links its release page; `docs/release-notes.md` replaces the previous "Changes in" section with this release's user-visible changes (read `git log PREV..HEAD`; describe behavior, not code); `docs/known-limitations.md` is read and corrected where the release changed something.
4. **Third-party notices:** if `git diff --stat PREV..HEAD` shows a change to a dependency lock file, review `THIRD_PARTY_NOTICES.md` for the added or changed packages, then run `python scripts/check_release_docs.py --update-fingerprints`.
5. **Checks:** `python scripts/check_release_docs.py vX.Y.Z` passes; core tests, `npm test`, `npx tsc --noEmit` and `npm run build` pass locally. (When a running core server holds the virtual environment, `uv run` cannot reinstall the package under the new version; run `.venv/Scripts/python -m pytest` instead.)
6. **Commit** "Set the version to X.Y.Z", with a body naming the files and what the release notes describe.
7. **Push `main` and wait for its `ci` run to pass on that exact commit.** CI runs on Linux; a pass on Windows alone is not enough. If it fails, fix on `main` and push again; the version commit does not need redoing. To investigate a failure that only happens on Linux, push a temporary branch that carries its own workflow (CI does not run on other branches), and delete the branch afterwards.
8. **Tag** the green commit and push only the tag: `git tag vX.Y.Z <commit>`, then `git push origin vX.Y.Z`.
9. **Watch the `release` run:** docs-check, create-draft, the four builds and ready must all pass, and the draft release must hold the Linux AppImage and the macOS arm64, macOS x64 and Windows zips.
10. **The owner publishes** the draft release by hand.

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

- Every source file starts with a comment (a docstring in the core) whose first sentence says its one job. `python scripts/module_map.py [words]` prints that sentence for every file, or for the files matching the words, so the right file is found without opening any; look there before adding code or a file.
- One job per file, named for that job. New behavior goes in a new file named for what it does, plus the one line that registers or imports it. Do not append it to the nearest large file, even when that file already has similar code; copy the pattern, not the location.
- Before adding code, ask what job it does. If it is the same job as an existing file, it belongs there; if it is a different job, it is a new file.
- A helper used by two or more callers goes in a shared module for that job (`shared/` in the core, a named helper file in the app); a helper used by one caller stays beside that caller.
- Keep a thin entry file. `main.ts`, `sketch.ts` and `viewport.ts` coordinate; the work they do is delegated to modules they import. Do not put new logic in them if a module can take it.
- When a file you touch is long (the pre-commit hook prints a note past about 400 lines), look at whether it holds more than one job. If it does, tell the owner and add a Planned row to `docs/progress.md` naming the file and the jobs mixed in it. Do not split it unasked in the same change, and do not ignore it.
- The line count is only a prompt. A long file with one clear job is fine; a short file doing three jobs is not.
- In `app/src`, write relative imports with the `.ts` extension (`"./name.ts"`). Node loads modules for the tests without a bundler and cannot resolve a bare `"./name"`, so one bare import makes every module that reaches it untestable; `tests/importstyle.test.mjs` checks this.
- App tests are every `app/tests/*.test.mjs` file; `npm test` finds them by itself, so a new test file needs no entry anywhere.

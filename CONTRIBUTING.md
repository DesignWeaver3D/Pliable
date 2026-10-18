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

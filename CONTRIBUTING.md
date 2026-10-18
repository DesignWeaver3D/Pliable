# Contributing

## Commit messages

Write commits for someone reading the log later.

- Subject: 12 to 72 characters, capitalized, imperative, no trailing period, no labels such as `S22:`, `feat:` or `Progress:`. Say what the change does.
- Body: any commit touching 3 or more files needs a short body saying what changed and why. Wrap lines at 80 characters.
- One commit per logical change, not one per work step.
- Do not name commercial products or other programs (other CAD tools, AI tools, vendors); describe the behavior instead.
- Documentation outside `docs/research/` should not name other products or describe behavior as matching them.

`scripts/check_commit_message.py` enforces the message rules. Enable the hook once per clone:

    git config core.hooksPath .githooks

The `commit-lint` workflow runs the same check on pushes and pull requests.

## Reference material

Notes in `docs/research/` summarize how other tools work, in our own words. Nothing is copied from them: no code, no text, no screenshots.

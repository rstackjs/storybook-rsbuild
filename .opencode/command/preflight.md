---
description: Run CI checks, auto-fix lint/snapshots, commit, optional push
---

## Context (auto-collected)

- Current branch: !`git rev-parse --abbrev-ref HEAD`
- Git status: !`git status --porcelain=v1`
- Changed files: !`git diff --name-only`
- Staged diff stat: !`git diff --cached --stat`
- Unstaged diff stat: !`git diff --stat`
- Recent commits: !`git log --oneline -10`
- Remotes: !`git remote -v`

## Workflow

@.agent/commands/preflight.md

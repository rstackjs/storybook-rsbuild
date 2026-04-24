---
name: storybook-sync
internal: true
description: Check and analyze upstream Storybook repository changes that may need to be synced to storybook-rsbuild. Use this skill whenever the user wants to check for upstream Storybook changes, review what's new in the official Storybook repo, identify changes needing sync, or compare storybook-rsbuild against the upstream. Activate for phrases like "check upstream", "sync check", "storybook changes", "need to sync", "what changed upstream", or any mention of tracking changes from storybookjs/storybook. Even casual mentions like "anything new in storybook?" should trigger this skill.
---

# Storybook Upstream Sync Checker

Analyze recent changes in the official `storybookjs/storybook` repository and identify which ones may need to be synced to this `storybook-rsbuild` repo. The storybook-rsbuild project adapts Storybook's official builder and framework packages to work with Rsbuild, so when upstream changes builder-webpack5, builder-vite, or framework integrations, those changes may need to be reflected here.

## Upstream to Local Package Mapping

```plaintext
+----------------------------------------+--------------------------------------+
| Upstream (storybookjs/storybook)       | Local (storybook-rsbuild)            |
+----------------------------------------+--------------------------------------+
| code/builders/builder-webpack5         | packages/builder-rsbuild             |
| code/builders/builder-vite             | packages/builder-rsbuild             |
| code/frameworks/react-vite             | packages/framework-react             |
| code/frameworks/react-webpack5         | packages/framework-react             |
| code/frameworks/vue3-vite              | packages/framework-vue3              |
| code/frameworks/web-components-vite    | packages/framework-web-components    |
| code/lib/core-webpack                  | packages/builder-rsbuild (prebundled)|
+----------------------------------------+--------------------------------------+
```

Both webpack5 and vite upstream variants are monitored because this repo borrows patterns from both.

## Upstream Commit History is Noisy

The Storybook repo uses a non-linear branching model with frequent merge commits and automated version bumps. The bundled script filters the most common noise automatically (version bump commits via `--invert-grep`, merge commits via `--no-merges`). Some noise may still slip through — NX upgrades, CI config, non-standard version bumps, reverts that cancel out.

**Always judge from the actual diff.** Storybook does not consistently follow conventional commits, so commit messages are unreliable for triage decisions.

## Sync Priority Criteria

**High** — sync soon:
- Bug fixes in logic that was adapted into storybook-rsbuild
- Security patches
- API / type / interface changes (options, preset signatures, exports)
- Breaking changes or deprecations

**Medium** — review and decide:
- New features that could benefit storybook-rsbuild users
- Significant refactoring of adapted code patterns
- Performance improvements in shared logic

**Low** — nice to know:
- Minor code quality improvements
- Added error handling or edge-case guards
- Test changes that reveal expected behavioral contracts

**Skip**:
- Webpack/Vite internal plumbing with no Rsbuild parallel (e.g. webpack plugin hooks, Vite-specific HMR wiring, Vite module graph internals)
- Documentation-only changes
- CI/tooling changes internal to the Storybook repo
- Changes to `storybook/internal/*` APIs (these arrive via the `storybook` npm dependency, not by manual sync)
- Pure test file additions with no behavioral insight
- Build system changes (NX, workspace config, import rewriting) that are specific to the Storybook monorepo structure

## Workflow

### 1. Preparation

Generate the report filename (anchored to system clock):
```bash
REPORT_NAME=$(bash <skill-dir>/scripts/fetch_upstream.sh --report-name)
```

Determine the commit range from the user's request:
- **Relative days**: "past 20 days", "last 30 days" → use `--days N`
- **Absolute date range**: "since 2025-12-01", "Dec 1 to Dec 20" → use `--since` / `--until`
- **Version tags**: "between v8.4.0 and v8.5.0" → use `--from` / `--to`
- If unspecified, default to `--days 30`.

**Important**: For relative date ranges, always use `--days N`. The script reads the system clock to compute exact dates, avoiding date miscalculation.

### 2. Get commit summary and decide strategy

Fetch the commit list with diff line counts:

```bash
bash <skill-dir>/scripts/fetch_upstream.sh --summary --days <N>
```

Output: `HASH|DATE|AUTHOR|SUBJECT|LINES_ADDED+LINES_DELETED` (one per line, oldest first — the script uses `--reverse`).

**Capture the range bounds from the summary output** — the first line's hash is `START_SHA` (oldest commit in range), the last line's hash is `END_SHA` (newest). These are the actual commits the report covers, regardless of whether the user asked for a date range, tag range, or commit range.

This is critical for reproducibility: `END_SHA` is exactly where the next sync run should start from, and `START_SHA` anchors the beginning to a precise ref even when the user specified a fuzzy bound like `--days 30` or `--since 2026-03-12`.

Based on the commit count:
- **≤ 8 commits** → step 3a (direct analysis)
- **> 8 commits** → step 3b (subagent analysis)

### 3a. Direct analysis (≤ 8 commits)

```bash
bash <skill-dir>/scripts/fetch_upstream.sh --diff-all --days <N>
```

For each commit in the output:
1. **Read the diff** — this is the ground truth. Never skip a commit based on its message or file list alone.
2. **Read the corresponding local source file** using the package mapping table above.
3. **Classify** using the sync priority criteria above.
4. **Check for revert chains** — if a commit and its revert both appear, check if the net effect is zero. If so, classify both as skip.

Then proceed to step 4.

### 3b. Subagent analysis (> 8 commits)

**Plan batches** using the `--summary` output:

1. Sum the total lines changed across all commits.
2. Target 3–5 subagents. Calculate: `target_lines_per_batch = total_lines / batch_count`.
3. Walk through the commit list in order. Accumulate commits into the current batch. When the accumulated lines exceed the target, start a new batch. Keep adjacent commits together when possible — they are often related.

**Spawn subagents** — one per batch. Launch all Agent calls in a single message without `run_in_background` so they execute in parallel as foreground calls. You will receive all results at once when they complete. Do NOT use `run_in_background`, do NOT `sleep` or poll.

Use this prompt template for each subagent (note `--no-fetch` — the primary agent already fetched in step 2):

```
Analyze upstream Storybook commits for sync relevance to storybook-rsbuild.

storybook-rsbuild adapts Storybook's builder and framework packages for Rsbuild.
When upstream changes their builder or framework code, those changes may need
to be reflected in storybook-rsbuild.

Package mapping (upstream → local):
  code/builders/builder-webpack5      → packages/builder-rsbuild
  code/builders/builder-vite          → packages/builder-rsbuild
  code/frameworks/react-vite          → packages/framework-react
  code/frameworks/react-webpack5      → packages/framework-react
  code/frameworks/vue3-vite           → packages/framework-vue3
  code/frameworks/web-components-vite → packages/framework-web-components
  code/lib/core-webpack               → packages/builder-rsbuild (prebundled)

Steps:
1. Run: bash <skill-dir>/scripts/fetch_upstream.sh --no-fetch --diff-all --hashes <COMMA_SEPARATED_HASHES>
2. For each commit, read its diff carefully — this is the ground truth.
   Commit messages are often inaccurate; always judge from the actual diff.
3. Read the corresponding local source file in storybook-rsbuild for comparison.
4. Classify each commit and return the results in the exact format below.

Priority criteria:
  high   — bug fix in adapted code, security patch, API/type change, breaking change
  medium — new feature worth adopting, significant refactoring of adapted patterns
  low    — minor improvement, added error handling, test revealing behavioral contract
  skip   — Vite/webpack internals with no Rsbuild parallel, docs, CI, storybook/internal API changes

Return format (one block per commit, separated by ---):

COMMIT: <full hash>
PRIORITY: high|medium|low|skip
UPSTREAM: <upstream package path, e.g. builders/builder-webpack5>
LOCAL: <local package path, e.g. packages/builder-rsbuild>
SUBJECT: <commit subject>
DATE: <YYYY-MM-DD>
AUTHOR: <author name>
WHAT_CHANGED: <1-2 sentence summary of the actual code change>
REASON: <why sync is needed, or why it can be skipped>
KEY_FILES: <comma-separated list of relevant changed files>
---
```

**Aggregate results**: Collect all subagent responses. Group commits by priority level. For revert chains where both the original and revert appear, check if the net effect is zero — if so, move both to skip.

### 4. Write the report

Save to `$REPORT_NAME` in the project root.

```markdown
# Storybook Upstream Sync Report

- **Range**: <range-label> ([`<START_SHA_SHORT>`](https://github.com/storybookjs/storybook/commit/<START_SHA>) → [`<END_SHA_SHORT>`](https://github.com/storybookjs/storybook/commit/<END_SHA>))
- **Generated**: YYYY-MM-DD
- **Upstream branch**: next
- **Commits scanned**: N (after filtering out version bumps and merges)
- **Needs attention**: X (H high, M medium, L low)

---

## High Priority

### [`abcdef0`](https://github.com/storybookjs/storybook/commit/FULL_HASH) commit subject here
- **Date**: YYYY-MM-DD  |  **Author**: name
- **Upstream package**: builders/builder-webpack5
- **Local package**: packages/builder-rsbuild
- **What changed**: 1-2 sentence summary of the actual code change.
- **Why sync**: Explanation of why this matters for storybook-rsbuild.
- **Key files**: list of relevant changed files

---

## Medium Priority

(same format as High)

## Low Priority

(briefer format — one paragraph per commit is sufficient)

## Skipped

(bullet list: `short-hash` subject — reason for skipping)
```

Commits within each priority section should be in chronological order (oldest first).

**Range line**: always pin both ends to precise linked SHAs — never leave "HEAD" or a bare date. Use `START_SHA` and `END_SHA` from step 2 (the first and last hashes of the `--summary` output). The `<range-label>` is a human-readable description of how the user specified the range:
- `--from v10.0.0 --to v10.1.0` → `v10.0.0..v10.1.0 ([\`abc1234\`](...) → [\`def5678\`](...))`
- `--from v10.0.0` (open end) → `v10.0.0..next ([\`abc1234\`](...) → [\`def5678\`](...))`
- `--since 2026-03-12 --until 2026-04-11` → `2026-03-12..2026-04-11 ([\`abc1234\`](...) → [\`def5678\`](...))`
- `--days 30` → `last 30 days (2026-03-12..2026-04-11) ([\`abc1234\`](...) → [\`def5678\`](...))`

This precision is critical for follow-up syncs — `END_SHA` becomes the exact starting ref (`--from <END_SHA>`) for the next run, regardless of whether the range ended at HEAD, a tag, or a past date.

### 5. Offer to create an issue

After writing the report, ask the user if they want to publish it as a GitHub issue in this repository. If yes, create the issue using `gh`:

```bash
gh issue create --title "<TITLE>" --body-file "$REPORT_NAME" --label "storybook sync report"
```

**Title format**: `Storybook Sync: <range>` — where `<range>` matches the range used in the report. Examples:
- Date range: `Storybook Sync: 2026-03-12 – 2026-04-11`
- Version range: `Storybook Sync: v8.4.0 – v8.5.0`

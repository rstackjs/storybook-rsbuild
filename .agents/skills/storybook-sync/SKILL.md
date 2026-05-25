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

Determine the commit range.

**Default (no user-specified range)** — continue from the last sync report. The `storybook sync report` label is fixed and used for every report this skill publishes.

1. Find the most recent sync report issue (any state — the newest one is the previous endpoint, regardless of whether it's been closed yet). Capture both the issue number and the body so the later range/title can reference it:
   ```bash
   LAST_REPORT=$(gh issue list --repo rstackjs/storybook-rsbuild --state all \
     --label "storybook sync report" --limit 1 --json number,body \
     --jq '.[0] | "\(.number)\n\(.body)"')
   PREV_ISSUE_NUMBER=$(printf '%s' "$LAST_REPORT" | head -1)
   LAST_BODY=$(printf '%s' "$LAST_REPORT" | tail -n +2)
   ```
2. Extract the previous END_SHA — it's the last `storybookjs/storybook/commit/<sha>` URL in the Range line:
   ```bash
   PREV_END_SHA=$(printf '%s' "$LAST_BODY" \
     | grep -oE 'storybookjs/storybook/commit/[a-f0-9]+' | tail -1 | sed 's|.*/||')
   ```
3. Pass `--from "${PREV_END_SHA}^"` so the boundary is **closed** (inclusive of PREV_END_SHA). The script uses git's `A..B` syntax, which is exclusive of A; the trailing `^` (parent) makes the new range re-include PREV_END_SHA. Re-processing that one commit is intentional — prefer running it twice over leaving a gap if upstream history shifted or boundary semantics are unclear at execution time.
4. If no prior report exists (empty `LAST_BODY` or no SHA parsed), fall back to `--days 30` and leave `PREV_ISSUE_NUMBER` empty.

**User-specified range** — overrides the default:
- **Relative days**: "past 20 days", "last 30 days" → use `--days N`
- **Absolute date range**: "since 2025-12-01", "Dec 1 to Dec 20" → use `--since` / `--until`
- **Version tags**: "between v8.4.0 and v8.5.0" → use `--from` / `--to`

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

---

<details>
<summary><b>For agents: how to act on this report</b> (trigger: <code>use #N</code> / <code>consume #N</code>)</summary>

**Scope**: resolve every **High Priority** item. Ignore Medium / Low / Skipped unless the user asks.

**Per item, do in order:**

1. **Re-verify** — this report is a snapshot, never act on it alone:
   - Upstream diff: `gh api repos/storybookjs/storybook/commits/<sha>`
   - Local file(s): read the package mapped from the commit's upstream path (mapping table is in the `storybook-sync` skill)
2. **Pick exactly one outcome** and post it as a comment on this issue:

| Outcome | When to choose | Comment body must contain |
|---|---|---|
| **Port** | implementable now against current local code | PR link |
| **Defer** | blocked by an external condition | blocker + concrete unblock signal (e.g. "storybook 10.5 stable ships `ChangeDetectionAdapter` types") |
| **Skip** | sync no longer needed | rationale (intentional divergence / upstream reverted / dead path locally) |

**Do not** re-run the `storybook-sync` skill from this issue — generating the next report is a separate workflow.

</details>

_Generated by the [`storybook-sync`](https://github.com/rstackjs/storybook-rsbuild/tree/main/.agents/skills/storybook-sync) skill._
```

Commits within each priority section should be in chronological order (oldest first).

**Do not add a "Next sync" / how-to-rerun section to the report body.** Re-running the skill is its own concern (see Workflow step 1, which finds the previous endpoint automatically from the last issue tagged `storybook sync report`). Putting rerun instructions inside the report duplicates the contract and rots when the skill changes.

**Range line**: always pin both ends to precise linked SHAs — never leave "HEAD" or a bare date. Use `START_SHA` and `END_SHA` from step 2 (the first and last hashes of the `--summary` output). The `<range-label>` is a human-readable description of how the user specified the range:
- **Default (continue from #N)** → `since #N ([\`<PREV_END_SHA_SHORT>\`](...) → [\`<END_SHA_SHORT>\`](...))`
  - Example: `since #480 ([b9549a6e](...) → [363433bc](...))`
  - **Do NOT** use `START_SHA`'s author date as the lower bound here. The `--from PREV_END_SHA^` range filters by **reachability**, not by date. Commits authored on long-lived feature branches and merged into `next` after the previous report will appear in the new range with author dates that predate the previous report's endpoint — labeling the start with that author date falsely suggests we're re-scanning a period already covered. The previous report's issue number is the only honest lower bound.
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
- Continue from prior report: `Storybook Sync: since #480` (use `since #<PREV_ISSUE_NUMBER>`; do not put commit author dates in the title — same reason as the Range line note above)
- Date range: `Storybook Sync: 2026-03-12 – 2026-04-11`
- Version range: `Storybook Sync: v8.4.0 – v8.5.0`

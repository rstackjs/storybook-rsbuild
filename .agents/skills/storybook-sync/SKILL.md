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
| code/frameworks/html-vite              | packages/framework-html              |
| code/presets/react-webpack             | packages/framework-react             |
| code/lib/core-webpack                  | packages/builder-rsbuild (prebundled)|
+----------------------------------------+--------------------------------------+
```

Both webpack5 and vite upstream variants are monitored because this repo borrows patterns from both.

This table defines **watch scope** — which upstream directories are scanned for commits. Counterpart questions ("does this file have a local port?") are answered at file granularity by `.agents/skills/storybook-check/manifest.json` (`mappings`), which also records each file's accepted intentional divergences. Packages listed here but absent from the manifest (builder-vite, core-webpack) are pattern sources rather than ports: triage judges their commits case by case for semantic relevance, and the manifest intentionally carries no entries for them — file-level mappings only make sense where a real port exists.

## Upstream Commit History is Noisy

The Storybook repo uses a non-linear branching model with frequent merge commits and automated version bumps. The bundled script filters the most common noise automatically (version bump commits via `--invert-grep`, merge commits via `--no-merges`). Some noise may still slip through — NX upgrades, CI config, non-standard version bumps, reverts that cancel out.

**Always judge from the actual diff.** Storybook does not consistently follow conventional commits, so commit messages are unreliable for triage decisions.

## Sync Priority Criteria

A wrong skip is the most expensive mistake this workflow can make: the next run starts after this range, so a skipped commit is never seen again, and the miss stays invisible until it resurfaces as a user-facing bug. When torn between two priorities, take the higher one.

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

- Webpack/Vite internal plumbing with no Rsbuild parallel (e.g. webpack plugin hooks, Vite-specific HMR wiring, Vite module graph internals). This label makes a factual claim — that no local counterpart exists — so earn it before using it: look up every touched file in `.agents/skills/storybook-check/manifest.json` (`mappings`), and for files the manifest doesn't list, check for a same-purpose local file. If any touched file has a counterpart, the claim is false and the commit is at least medium (high for bug fixes). Commit messages and file paths are not evidence here: files under `builder-webpack5/src/plugins/` and `src/loaders/` read as webpack-specific by path, yet are ported 1:1 into this repo.
- Documentation-only changes
- CI/tooling changes internal to the Storybook repo
- Changes to `storybook/internal/*` APIs (these arrive via the `storybook` npm dependency, not by manual sync)
- Pure test file additions with no behavioral insight
- Build system changes (NX, workspace config, import rewriting) that are specific to the Storybook monorepo structure

## Workflow

`<skill-dir>` below means `.agents/skills/storybook-sync` (use an absolute path when the command is copied into a subagent prompt). Shell variables do not persist between tool calls: run each step's commands in one shell, or re-inline the values.

Every run covers the range from ANCHOR through TARGET on upstream `next`. Both ends are git refs (tag or sha, treated identically) and must be reachable from `origin/next`: patch tags live on `main` via cherry-picks; their source commits are on `next`. The range includes the anchor itself; re-triaging one commit beats leaving a gap.

### 1. Determine the range

**TARGET (end ref) — always user-specified.** Every run is user-triggered and the user names the target: a tag (`v11.0.0`, `v11.0.0-alpha.3`) or a commit sha. Never pick a target yourself; if the user gave none, ask for one.

**ANCHOR (start ref) — continue from the last sync report by default.** The `storybook sync report` label is fixed and used for every report this skill publishes.

1. `TARGET=<the ref the user named>` (a tag or commit sha).
2. Recover the previous report's anchor:
   ```bash
   read -r PREV_ISSUE_NUMBER ANCHOR < <(gh issue list --repo rstackjs/storybook-rsbuild \
     --state all --label "storybook sync report" --limit 1 --json number,body \
     --jq '.[0] | select(.) | "\(.number) \((.body | capture("<!-- storybook-sync: target=(?<sha>[a-f0-9]{40}) -->").sha) // "")"')
   ```
   Three outcomes: both set → continue; `PREV_ISSUE_NUMBER` set but `ANCHOR` empty → the newest report (#N) predates the marker; nothing set → no prior report exists.
3. If the user named a start ref, `ANCHOR=<that ref>` and clear `PREV_ISSUE_NUMBER` (the report is not continuing from an issue). Otherwise, if `ANCHOR` is empty, stop and ask the user for a start ref, saying which of the two empty cases applies.

**Resolve both ends** (this also fetches the cache and validates the refs):

```bash
{ IFS=$'\t' read -r ANCHOR_SHA ANCHOR_LABEL; IFS=$'\t' read -r TARGET_SHA TARGET_LABEL; } \
  < <(bash <skill-dir>/scripts/fetch_upstream.sh --resolve "$ANCHOR" "$TARGET")
REPORT_NAME="upstream-sync-report-${ANCHOR_LABEL}-${TARGET_LABEL}.md"
```

Labels come from the script: the ref as written, or an 8-char sha for a bare commit.

### 2. Get commit summary and decide strategy

Fetch the commit list with diff line counts:

```bash
bash <skill-dir>/scripts/fetch_upstream.sh --no-fetch --summary --from "$ANCHOR_SHA" --to "$TARGET_SHA"
```

Output: `HASH|DATE|AUTHOR|SUBJECT|LINES_ADDED+LINES_DELETED` (one per line, oldest first — the script uses `--reverse`).

If the summary is empty, skip analysis and go to step 4. Otherwise, based on the commit count:

- **≤ 8 commits** → step 3a (direct analysis)
- **> 8 commits** → step 3b (subagent analysis)

### 3a. Direct analysis (≤ 8 commits)

Use the hashes from step 2:

```bash
bash <skill-dir>/scripts/fetch_upstream.sh --no-fetch --diff-all --hashes <H1,H2,...>
```

For each commit in the output:

1. **Read the diff** — this is the ground truth. Never skip a commit based on its message or file list alone.
2. **Read the corresponding local source file** — resolve it at file granularity via `.agents/skills/storybook-check/manifest.json` (`mappings`), falling back to the package table only for files the manifest doesn't list. Open the file rather than inferring from its name: a skip verdict of "no Rsbuild parallel" is only as good as the search that failed to find one.
3. **Classify** using the sync priority criteria above.
4. **Check for revert chains** — if a commit and its revert both appear, check if the net effect is zero. If so, classify both as skip.

Then proceed to step 4.

### 3b. Subagent analysis (> 8 commits)

**Plan batches** using the `--summary` output:

1. Sum the total lines changed across all commits.
2. Target 3–5 subagents. Calculate: `target_lines_per_batch = total_lines / batch_count`.
3. Walk through the commit list in order. Accumulate commits into the current batch. When the accumulated lines exceed the target, start a new batch. Keep adjacent commits together when possible — they are often related.

**Spawn subagents** — one per batch. Launch all Agent calls in a single message without `run_in_background`, so they execute in parallel as foreground calls and their results all arrive together — no sleeping or polling needed.

Use this prompt template for each subagent (note `--no-fetch` — the primary agent already fetched in step 1):

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
  code/frameworks/html-vite           → packages/framework-html
  code/presets/react-webpack          → packages/framework-react
  code/lib/core-webpack               → packages/builder-rsbuild (prebundled)

Steps:
1. Run: bash <skill-dir>/scripts/fetch_upstream.sh --no-fetch --diff-all --hashes <COMMA_SEPARATED_HASHES>
2. For each commit, read its diff carefully — this is the ground truth.
   Commit messages are often inaccurate; always judge from the actual diff.
3. Resolve each touched upstream file to its local counterpart using
   .agents/skills/storybook-check/manifest.json (mappings array, file-level),
   falling back to the package mapping above. Read the local file —
   classification is a comparison, not a guess.
4. Classify each commit and return the results in the exact format below.

Priority criteria:
  high   — bug fix in adapted code, security patch, API/type change, breaking change
  medium — new feature worth adopting, significant refactoring of adapted patterns
  low    — minor improvement, added error handling, test revealing behavioral contract
  skip   — Vite/webpack internals with no Rsbuild parallel, docs, CI, storybook/internal API changes

A skipped commit is never revisited by this workflow, so "no Rsbuild parallel"
must be earned: it is only valid if none of the commit's touched files has a
local counterpart — in the manifest or by same-purpose inspection. If any
touched file maps to a local file, the commit is at least medium (high for bug
fixes). Commit messages and file paths are not evidence; plugin and loader
files that read as webpack-specific by path are ported 1:1 into this repo.

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

- **Range**: <ANCHOR_LABEL> → <TARGET_LABEL> ([`<ANCHOR_LABEL>`](https://github.com/storybookjs/storybook/commit/<ANCHOR_SHA>) → [`<TARGET_LABEL>`](https://github.com/storybookjs/storybook/commit/<TARGET_SHA>))
- **Generated**: YYYY-MM-DD
- **Upstream branch**: next
- **Commits scanned**: N (after filtering out version bumps and merges)
- **Needs attention**: X (H high, M medium, L low)

---

## High Priority

### [`abcdef0`](https://github.com/storybookjs/storybook/commit/FULL_HASH) commit subject here

- **Date**: YYYY-MM-DD | **Author**: name
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
   - Local file(s): resolve each touched upstream file via `.agents/skills/storybook-check/manifest.json` (`mappings`), falling back to the package mapping table in the `storybook-sync` skill, and read them
2. **Pick exactly one outcome** and post it as a comment on this issue:

| Outcome   | When to choose                               | Comment body must contain                                                                             |
| --------- | -------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| **Port**  | implementable now against current local code | PR link                                                                                               |
| **Defer** | blocked by an external condition             | blocker + concrete unblock signal (e.g. "storybook 10.5 stable ships `ChangeDetectionAdapter` types") |
| **Skip**  | sync no longer needed                        | rationale (intentional divergence / upstream reverted / dead path locally)                            |

**Do not** re-run the `storybook-sync` skill from this issue — generating the next report is a separate workflow.

</details>

_Generated by the [`storybook-sync`](https://github.com/rstackjs/storybook-rsbuild/tree/main/.agents/skills/storybook-sync) skill._
<!-- storybook-sync: target=<TARGET_SHA> -->
```

Commits within each priority section should be in chronological order (oldest first).

Don't add a "Next sync" / how-to-rerun section to the report body. Re-running the skill is its own concern (see Workflow step 1, which finds the previous anchor automatically from the last issue tagged `storybook sync report`). Putting rerun instructions inside the report duplicates the contract and rots when the skill changes.

- The label part is `<ANCHOR_LABEL> → <TARGET_LABEL>` (e.g. `v10.6.0 → v11.0.0-alpha.3`, `aa5790bb → v10.6.0`); when continuing from a report, the anchor label is `since #<PREV_ISSUE_NUMBER>` instead (e.g. `since #544 → v10.6.0`).

Never describe the range by author dates — the range is defined by reachability, and long-lived branches merged after the anchor carry author dates that predate it.

### 5. Offer to create an issue

After writing the report, ask the user if they want to publish it as a GitHub issue in this repository. If yes, create the issue using `gh`:

```bash
gh issue create --title "<TITLE>" --body-file "$REPORT_NAME" --label "storybook sync report"
```

**Title format**: `Storybook Sync: <label part of the Range line>`.

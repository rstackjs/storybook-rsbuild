---
name: storybook-check
internal: true
description: Audit ported storybook-rsbuild source files against the CURRENT upstream Storybook source, grouped by the local package that owns each port, independent of commit history. Use this skill whenever the user wants to verify nothing was missed in porting, audit drift against upstream, double-check sync triage, or suspects an upstream fix never landed here. Activate for phrases like "check drift", "audit against upstream", "are we missing anything from storybook", "source-level check", "verify ported files", "did we port this", and also right after a storybook-sync report has been consumed — a check run is how its triage gets verified. This complements (does not replace) the storybook-sync skill.
---

# Storybook Upstream Drift Checker

Compare the **current content** of upstream Storybook source against its local storybook-rsbuild counterparts. This is the safety net under the `storybook-sync` skill.

## Why this exists

`storybook-sync` consumes the upstream **commit stream** incrementally: each report starts where the previous one ended, and every commit gets a one-shot triage judgment. A wrong judgment is permanent — the commit is never looked at again, and the miss stays invisible until it resurfaces as a user-facing bug.

This skill covers that structural blind spot: **every run is a full, stateless sweep** over current file contents on both sides. Nothing is skipped because of a previous run, so any drift — including drift a past sync triage judged wrongly — shows up on every run until it is actually resolved.

## Ground rules

1. **Full sweep, no memory.** Audit every mapping on every run. Skipping "already checked" pairs would reintroduce exactly the failure mode this skill exists to catch: a judgment error that nothing ever revisits.
2. **Verify the mapping before the content.** File sets change on both sides — upstream adds, renames, and deletes files, and so does this repo. Repair the manifest first; auditing content through an outdated mapping produces false confidence.
3. **The audit unit is the local package, judged behavior by behavior.** The mapping is not cleanly 1:1 in either direction — several upstream files fold into one local file, several upstream _packages_ can feed one local package (framework-react ports from react-webpack5, react-vite, and presets/react-webpack), and some upstream files have no direct counterpart at all. Grouping by what receives the port keeps every behavior that lands in one local package under one pair of eyes, and stops the same file being judged twice by agents that can't see each other's findings.
4. **Intentional divergences live in the manifest**, not in your judgment. If you discover a new legitimate divergence, add it to the manifest in the same change — undocumented divergences are indistinguishable from bugs on the next run.
5. **`local: null` entries still get reviewed.** No direct counterpart doesn't mean irrelevant — review the upstream file for semantic parallels per the entry's `note`.

## Files

- `manifest.json` — the file-level mapping: upstream path → local path (`null` plus `reviewWith` for review-only entries), plus `intentionalDivergences` (accepted deliberate differences), `ignoredUpstreamFiles`, and `localOnlyFiles`. Committed state; keeping it accurate is part of the workflow.
- `scripts/check-upstream.mjs` — deterministic git plumbing over the shared blobless cache (`~/.cache/storybook-upstream/`, same cache as storybook-sync). Plain Node, no dependencies or build step: run it with `node`. `--help` lists every mode.

## Workflow

### 1. Mapping maintenance (package level first)

```bash
node <skill-dir>/scripts/check-upstream.mjs --coverage
```

This validates the manifest — first for internal consistency, then against reality on both sides:

- `INVALID-MANIFEST` — the entry itself is malformed: a review-only entry with no `reviewWith`, a duplicate `upstream`, a `reviewWith` on an entry that already has a `local`, or one pointing at a package that isn't there. These block step 2, which partitions on exactly those fields.
- `MISSING-UPSTREAM` — a mapped upstream file no longer exists. Track the rename (`git -C ~/.cache/storybook-upstream log --follow --format='%H %s' -5 origin/next -- <path>`) and fix the entry.
- `UNMAPPED` — a new upstream file with no mapping decision. Map it, or add it to `ignoredUpstreamFiles`. A new mapping needs a `local` path, or `local: null` plus a `reviewWith` naming the local package that reviews it — grouping in step 2 depends on that field.
- `MISSING-LOCAL` — a mapped or local-only file was removed from this repo. Fix the entry.
- `UNLISTED-LOCAL` — a new local file the manifest doesn't know. Map it or add to `localOnlyFiles`.

Before descending to individual files, sanity-check the **package-level shape**: does each upstream package still map to the same local package (per the mapping table in the `storybook-sync` skill)? A package split, rename, or restructure upstream invalidates file mappings wholesale and must be reflected in the manifest first.

Resolve all coverage findings — commit the manifest fix — before step 2. If coverage is complete, proceed directly.

### 2. Drift audit (one subagent per local package)

The partition is computed for you — don't hand-derive it from the manifest:

```bash
node <skill-dir>/scripts/check-upstream.mjs --no-fetch --groups
```

Output is `GROUP|UPSTREAM|LOCAL`, where `GROUP` is the local package that owns the port. Spawn one subagent per distinct `GROUP`, all in one message as parallel foreground Agent calls (no `run_in_background`), so results arrive together. Keep each group whole: the mappings converge many-to-one on both axes (`iframe-webpack.config.ts` + `base-webpack.config.ts` + `custom-webpack-preset.ts` all land in `iframe-rsbuild.config.ts`; react-webpack5, react-vite and presets/react-webpack all land in framework-react), so only an agent holding the entire group can tell "this behavior lives in a different file here" from "this behavior is missing".

Each subagent's prompt must carry three things — the exact wording is yours:

1. **Inputs**: the group's manifest slice (mappings with their notes) and the accepted `intentionalDivergences`, stated as not-to-be-reported. How to fetch upstream content (`node check-upstream.mjs --no-fetch --show <path>`); local files are read directly.
2. **Method**: compare across the whole local package, behavior by behavior. The port is adapted (webpack→rspack idioms), not copied, and not structured 1:1 — a behavior may live in a different local file than its upstream declaration, and `local: null` entries may still have semantic parallels (see their notes). A behavior is _present_ if it exists anywhere appropriate in the local package, and _missing_ only after checking all of it.
3. **Output**: a verdict plus, per missing behavior: what upstream does, where the evidence is on each side, the **provenance** — the upstream commit and PR that introduced the behavior, with upstream's stated reason for the change — and a severity (high = bugfix/correctness, medium = feature/perf, low = polish). Also have it surface divergences that look deliberate but are not yet in the manifest, and notable local-only behaviors. Keep the shape consistent across subagents so results aggregate cleanly.

**Tracing provenance.** Whether a behavior is worth porting usually turns on _why_ upstream added it — a correctness fix ports, a webpack-only workaround may not — so a finding without its origin story is only half a finding. To trace one: `node check-upstream.mjs --no-fetch --log <upstream-path>` lists recent commits touching a file, and `git -C ~/.cache/storybook-upstream log -S'<distinctive snippet>' --format='%H|%ai|%s' origin/next -- <path>` pinpoints the commit that introduced a specific piece of code. Commit subjects don't carry PR numbers (Storybook merges branches rather than squashing), so resolve the PR from the commit: `gh api repos/storybookjs/storybook/commits/<sha>/pulls --jq '.[0] | {number, title, body}'` — the PR body is upstream's own explanation. The log explains a drift, it never establishes one — content stays the ground truth.

### 3. Disposition

For each missing finding, exactly one outcome, decided with the user (or per their standing instruction):

- **Port** — implement it (separate commit/PR, referencing the upstream PR from the finding's provenance).
- **Intentional** — add to the entry's `intentionalDivergences` with a rationale, in the same change.
- **Defer** — record the blocker in the report. Nothing else to do: the full sweep re-surfaces it automatically on the next run.

### 4. Report

Write `upstream-check-report-<YYYYMMDD>.md` to the project root and summarize the findings in your response:

```markdown
# Storybook Upstream Drift Check

- **Generated**: YYYY-MM-DD
- **Upstream**: storybookjs/storybook@next (`<short-sha of origin/next>`)
- **Packages audited**: N — **Findings**: X missing behaviors (H high, M medium, L low)

## Findings

(per package: table of missing behaviors with severity, evidence on both sides,
upstream PR + upstream's reason for the change, disposition)

## Deferred

(findings left open, with blockers — these re-surface automatically next run)

## Mapping changes

(manifest entries added/updated this run, with reasons)
```

The report file and the response summary are for the human; the manifest commit is the only persistent state, and it only changes when mappings or intentional divergences change.

## Relationship to storybook-sync

- **sync** = incremental commit-stream triage; fast, catches things early, but one-shot judgments.
- **check** = stateless full-content audit; heavier per run, but immune to triage mistakes by construction.

Run check after consuming a sync report (to verify the triage), and periodically (monthly or per upstream minor release) regardless. The two are independent by design: check results never feed sync's range tracking, and sync reports never scope what check audits.

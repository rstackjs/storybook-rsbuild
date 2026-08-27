# Upstream Porting & Sync

This repo adapts upstream `storybookjs/storybook` (mainly `builder-webpack5`, with `builder-vite` as a second reference) onto Rsbuild. Tracking runs on two skills: `storybook-sync` (incremental commit triage) and `storybook-check` (stateless full-content drift audit) — their mechanics live in `.agents/skills/storybook-{sync,check}/SKILL.md`. This guide carries the porting doctrine.

## Doctrine: pure port

- Follow upstream behavior — implementation, naming, semantics, and the dependency set are copied from upstream; only Rsbuild/Rspack-mandated mechanical adaptation is allowed. Mirror upstream's structure 1:1 even when it duplicates logic locally; staying literally identical reduces noise in every future drift comparison. Dependency **classification** follows the local bundle-vs-external contract, not upstream's placement — check `getExternal` before adopting it (see [dependencies.md](dependencies.md)).
- Port upstream's **intent**, not lines, in two cases: a capability upstream implemented only on the Vite side (port the Vite semantics onto Rsbuild APIs), and an upstream implementation that is broken under the current core (port the intent, record the deviation).
- A perceived upstream bug or better approach is reported to the user, never implemented unilaterally. Deviating needs the user's explicit approval, presented as a binary choice (upstream-literal vs. local variant).
- Every approved deviation is recorded twice, in the same change: an `intentionalDivergences` line in the manifest (see [project-structure.md](project-structure.md)), and an in-code comment on exactly the lines a future sync would silently revert. Comments in ported code cite an upstream permalink instead of copying upstream's own comment text.
- Both upstream builders count as precedent: a divergence from `builder-webpack5` is not a divergence if `builder-vite` does it.
- `templates/preview.ejs` stays verbatim-aligned with upstream `builder-webpack5`; no new divergence in it.

## Porting a change

- Port every touched file that has a mapped or same-purpose local counterpart (plus the tests covering the behavior), together with follow-up commits already folded into upstream's current state — porting only part of the counterpart set is a defect. Upstream-only files (docs, CI/tooling, `storybook/internal/*`) stay out, per the sync skill's skip rules.
- Verify against the **current** upstream source on `next`, never against the referenced upstream PR (the PR may be stale). `next` is the reference for verification and drift detection; a Storybook **release** is the trigger for adopting a capability that is unreleased or unstable — a port blocked on an unreleased upstream API is implemented and parked as a green draft PR naming the unblock signal, not reimplemented around the block.
- Never copy an upstream config value or version gate bare: port the preconditions that make the value valid, and translate webpack-version conditions into their rspack equivalents.
- Work upstream did not do (restructuring sandboxes, fixing pre-existing behavior that matches upstream) is out of scope for a port PR.
- One upstream cluster per branch/PR, cut from latest `origin/main` and rebased before push — never stacked on an unmerged branch. The PR cites the originating upstream PRs (`redirect.github.com` links) and declares any unportable parts. Manifest updates ride in the port PR, never as a separate PR.

## Triage & interaction rules

- Before accepting a reported behavior as this repo's bug, read how the upstream builders implement the same logic. Behavior aligned with upstream is not this repo's bug; a defect that reproduces identically upstream is left in place — with a TODO at the port site stating the tracked upstream fix and the correct alternative — not fixed as a silent divergence.
- Never act proactively on the upstream repository: no issues, no PRs, no reporting locally-found bugs upstream.
- Review-bot feedback that would cause divergence from upstream is declined in-thread ("faithful port of upstream <commit>"); only a genuinely serious finding (real bug, security, build failure) is an exception, and it is escalated to the user.
- Sync/port PRs are never self-merged — the merge decision is the user's.

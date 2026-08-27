# Commit & Pull Request Workflow

## Commits

- Follow **Conventional Commits**: `feat:`, `fix(builder-rsbuild):`, `chore(deps):`.
- Subject line under 72 characters.
- `git commit` fires a `simple-git-hooks` pre-commit hook (`npx nano-staged`) that **rewrites staged files in place**: `biome check --write` over staged `*.{js,jsx,ts,tsx,mjs,cjs,json,css,less,scss}`, plus `sort-package-json` on every staged `package.json`. The commit can therefore differ from what you staged — read back with `git show HEAD` before reporting a diff, and never bypass with `--no-verify` (unformatted code fails CI's `pnpm lint`, which gates the merge via the `ci-passed` aggregator).

## Linking upstream storybookjs/storybook

When linking a PR or issue of the upstream `storybookjs/storybook` repository in an issue/PR body or comment, use the `redirect.github.com` host (e.g. `https://redirect.github.com/storybookjs/storybook/pull/14281`) so GitHub does not create backlink notifications on the upstream thread. Use a plain `github.com` link only when explicitly asked to mention/ping that PR or issue. Links to other repositories and plain commit messages are unaffected.

## Before pushing

1. Verify dependency manifests and `pnpm-lock.yaml` are in sync (see [dependencies.md](dependencies.md)).
2. Run the PR checklist commands below that cover your change and fix failures locally instead of relying on CI to catch them.

## PR checklist

CI runs these on the PR; all must be green before merge (order matches CI — it never runs a bare `pnpm build`; `pnpm build:test` covers it, see [testing.md](testing.md) for its side effect on `dist/`):

- `pnpm lint`
- `pnpm check`
- `pnpm check-dependency-version`
- `pnpm build:sandboxes`
- `pnpm test`
- `pnpm build:test`
- `pnpm e2e`

Two things the list does not show:

- The lint/type-check job runs in parallel with the test matrix; a Biome, type, or dependency-version failure still blocks the merge through the `ci-passed` aggregator even when every test job is green. Run `pnpm lint` first.
- A PR whose diff touches only safelisted paths (docs, website, editor config — the exact filter lives in `.github/workflows/ci.yaml`) skips the test matrix, so a green check there proves nothing about tests. `.agents/**` is not safelisted — the agent skills and the port manifest live there, and the safelisted `.claude/skills` is only a symlink to it. The filter applies to `pull_request` events only; pushes to `main`, merge groups, and manual dispatches run the full matrix.

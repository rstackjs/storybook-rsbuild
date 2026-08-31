# Commit & Pull Request Workflow

## Commits

- Follow **Conventional Commits**: `feat:`, `fix(builder-rsbuild):`, `chore(deps):`.
- Subject line under 72 characters.
- `git commit` runs the `rs hooks`-managed `.rstack/hooks/pre-commit` hook, which invokes `rstack staged` and **rewrites staged files in place**: `rstack fmt` over staged `*.{js,jsx,ts,tsx,mjs,cjs,json,css,less,scss}`. Rstack auto-sorts imports through `prettier-plugin-organize-imports` and package fields through its `sortPackageJson` setting. Invoke Rstack rather than Prettier or ESLint directly. The commit can therefore differ from what you staged — read back with `git show HEAD` before reporting a diff. `RSTACK_HOOKS=0` is the only sanctioned emergency skip mechanism, but it is forbidden for normal work; never bypass hooks with `--no-verify`.
- Linked worktrees (for example, `.claude/worktrees/*`) share `core.hooksPath`, but the generated `.rstack/hooks/_` directory is per checkout. Until `pnpm install` or `pnpm exec rstack hooks` has run in that worktree, Git finds no hooks and commits silently without formatting. Run one of them before the first commit in a fresh worktree.

## Linking upstream storybookjs/storybook

When linking a PR or issue of the upstream `storybookjs/storybook` repository in an issue/PR body or comment, use the `redirect.github.com` host (e.g. `https://redirect.github.com/storybookjs/storybook/pull/14281`) so GitHub does not create backlink notifications on the upstream thread. Use a plain `github.com` link only when explicitly asked to mention/ping that PR or issue. Links to other repositories and plain commit messages are unaffected.

## Before pushing

1. Verify dependency manifests and `pnpm-lock.yaml` are in sync (see [dependencies.md](dependencies.md)).
2. Run the PR checklist commands below that cover your change and fix failures locally instead of relying on CI to catch them.

## PR checklist

CI runs these on the PR; all must be green before merge (order matches CI — it never runs a bare `pnpm build`; `pnpm build:test` covers it, see [testing.md](testing.md) for its side effect on `dist/`):

- `pnpm check`
- `pnpm type-check`
- `pnpm check-dependency-version`
- `pnpm build:sandboxes`
- `pnpm test`
- `pnpm build:test`
- `pnpm e2e`

Two things the list does not show:

- The check job runs in parallel with the test matrix; an Rstack formatting, Rslint, type, or dependency-version failure still blocks the merge through the `ci-passed` aggregator even when every test job is green. Run `pnpm check` first.
- A PR whose diff touches only safelisted paths (docs, website, editor config — the exact filter lives in `.github/workflows/ci.yaml`) skips the test matrix, so a green check there proves nothing about tests. `.agents/**` is not safelisted — the agent skills and the port manifest live there, and the safelisted `.claude/skills` is only a symlink to it. The filter applies to `pull_request` events only; pushes to `main`, merge groups, and manual dispatches run the full matrix.

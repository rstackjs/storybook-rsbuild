# AGENTS.md

storybook-rsbuild is a pnpm monorepo providing an Rsbuild-powered Storybook builder, framework packages, and addons.

## Always

- Use **pnpm** — never `npm` or `yarn`.
- Use **Rstack CLI** for formatting, import organization, and linting — never invoke Prettier or ESLint directly. `rstack fmt` auto-sorts imports through `prettier-plugin-organize-imports`; never sort them manually.
- Use **Rstest** for unit testing.
- Name directories, files, and packages in **kebab-case**. Exempt: tool-mandated names (e.g. Rspress `_nav.json` / `_meta.json`), upstream-ported filenames, test fixture components, and the camelCase helpers in `e2e/utils/` and `tests/helpers/`.
- Propose a short plan before executing a complex refactor.

## Commands

```bash
pnpm exec rstack fmt path/to/file.tsx       # format a single file (preferred)
pnpm exec rstack lint path/to/file.tsx      # lint a single file (preferred)
pnpm exec rstack test path/to/file.test.ts  # run tests for a single file (preferred)
pnpm check                                  # lint + type check + formatting check
```

## Ask first

- `git push` — sole exception: the version commit of a **user-initiated** release (see [docs/release.md](docs/release.md)).
- Adding a new dependency (running `pnpm install` itself needs no prompt — see [docs/dependencies.md](docs/dependencies.md)).
- Deleting files or large code blocks.
- Full repo builds (root `pnpm build`, `pnpm build:test`, `pnpm build:sandboxes`) — except when validating changes before a push/PR or when a documented workflow requires it. Workspace-scoped builds (e.g. `pnpm --filter website build`) need no prompt.

## Topic guides

Read the matching guide before starting the task:

- Working in `website/` → [website/AGENTS.md](website/AGENTS.md)
- Committing, pushing, or opening/updating a PR → [docs/git-workflow.md](docs/git-workflow.md)
- Editing dependency manifests or lockfiles, or after a `rebase` / `merge` / `stash pop` → [docs/dependencies.md](docs/dependencies.md)
- Writing/running tests, sandboxes, or e2e → [docs/testing.md](docs/testing.md)
- Porting or syncing code from upstream `storybookjs/storybook`, or acting on a sync/check report → [docs/upstream-port.md](docs/upstream-port.md)
- Releasing/publishing → [docs/release.md](docs/release.md)
- Repo layout, package `exports` / `build-config.ts`, or touching anything under `packages/*/src` → [docs/project-structure.md](docs/project-structure.md)

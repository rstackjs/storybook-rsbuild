# Testing & Sandbox Workflow

## Unit tests (Rstest)

- Tests live in the package-level `tests/` directory, mirroring the `src/` structure (e.g. `packages/builder-rsbuild/tests/preview/`). Cross-package integration tests live in the root `tests/` project.
- Exception: the ported `packages/framework-react/src/plugins/react-docgen-typescript/__tests__/` suite (with its `__fixtures__`/`__snapshots__`) stays in its upstream layout — never relocate it.
- The root `rstest.config.ts` aggregates projects by glob — `./packages/*/rstest.config.ts`, `./sandboxes/*/rstest.config.ts`, and `./tests/rstest.config.ts`. A package or sandbox without its own `rstest.config.ts` is silently skipped, with no error.
- The root `tests/` project sets `include: ['./*.test.ts']` — top level only. A file at `tests/<subdir>/foo.test.ts` never runs and never warns; put cross-package integration tests directly in `tests/` and keep shared code in `tests/helpers/` (not a test glob).
- The shared `rstest-setup.ts` replaces `console.warn`/`console.error` with functions that **throw** unless the message matches its `ignoreList` — a code path that warns fails as a bare `Error: warn: ...` with a stack pointing into `src/`. Spy on the console in the test instead; never silence the warning in `src/`. (The root `tests/` project uses its own spy-free setup.)
- `pnpm test` is not self-contained: the chromatic suites read `sandboxes/react-18/storybook-static/preview-stats.json`, a gitignored build output. On a clean checkout run `pnpm build:sandboxes` first (CI's order) — those `ENOENT` failures are not a regression in your change.

## Sandboxes & e2e (Playwright)

- Update relevant `sandboxes/` when adding or modifying features. Colocate sandbox helpers with their owning packages.
- Sandboxes and e2e resolve the packages through `packages/*/dist`, never `src/`. Unit tests import `src/` and see edits immediately; sandboxes do not. After editing a package's `src/`, run `pnpm --filter ./packages/<dir> prep` (or keep root `pnpm dev` running — it is `prep --watch` over the packages, not a Storybook server) before trusting a sandbox or e2e result. Use the `./packages/<dir>` path form: `--filter` otherwise matches the **npm** name, which differs from the directory (`packages/framework-vue3` → `storybook-vue3-rsbuild`), and a bare directory name matches no project yet still exits 0.
- Run `pnpm build:test` (not plain `pnpm build`) before `pnpm e2e`: it bakes `SB_RSBUILD_TEST_MINIMAL_DEV=true` into `dist/` as an Rslib build-time define, disabling HMR and lazy compilation — the state CI's e2e runs against. That state is fragile, not durable: every `prep`, `build`, and watch run deletes `dist/` first and re-injects the define only when the env var is set for that run, so starting root `pnpm dev` after `build:test` silently strips it. Only `packages/builder-rsbuild` reads the flag — re-`prep`ing any other package mid-loop is harmless; after editing `builder-rsbuild` itself, re-run `pnpm build:test`. After e2e, run `pnpm build` to restore a normal `dist/`, and never diagnose an "HMR is broken" report against a `build:test` output.
- Run e2e tests for a specific sandbox: `pnpm e2e <sandbox>.spec.ts` (specs live in `e2e/tests/`, one per sandbox). First run needs the browser runtime: `pnpm exec playwright install chromium`.
- Debugging: reproduce locally, then inspect the DOM with your browser-automation tooling — the Storybook preview is an iframe.

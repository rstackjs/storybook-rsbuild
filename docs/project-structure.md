# Project Structure

- **`packages/builder-rsbuild`**: The Rsbuild builder — the core package. The `Release` workflow reads the release version from its `package.json`.
- **`packages/framework-*`**: Renderer packages (`html`, `react`, `react-native-web`, `vue3`, `web-components`). Runtime logic stays in `src/`.
- **`packages/addon-*`**: Storybook addons (`modernjs`, `rslib`).
- **`packages/rsbuild-plugin-react-native-web`**: Standalone Rsbuild plugin consumed by `framework-react-native-web`.
- **`scripts/`**: Shared package-build helpers and check tooling (`build/create-rslib-config.ts`, `build/utils/`, `check/check-package.ts`, `check-dependency-version.mts`). A `pnpm-workspace.yaml` member — see [release.md](release.md) on `"private": true`.
- **`sandboxes/`**: Runnable Storybook apps for regression testing.
- **`e2e/`**: Playwright e2e — see [testing.md](testing.md).
- **`tests/`**: Root-level cross-package integration test project — see [testing.md](testing.md).
- **`docs/`**: Agent topic guides referenced from [AGENTS.md](../AGENTS.md) — not published documentation (that is `website/`).

## Package build

- `packages/<pkg>/build-config.ts` is the single source of truth for entry points and the `exports` map. `@storybook/scripts/create-rslib-config` derives the Rslib entries and owns shared build semantics such as platform, syntax target, externals, dts, shims, and chunks. The package-local `rslib.config.ts` passes only its `build-config.ts` and explicit package-specific options.
- Every full build (`build` and the `prepare` script that `pnpm install` triggers) rewrites the `exports` field of the **source** `packages/<pkg>/package.json` from `build-config.ts` — hand-edited `exports` entries are silently reverted with no error. To add or rename a subpath export, edit `build-config.ts` (`exportEntries` / `entryPoint`, or `extraOutputs` for raw non-JS files) and rebuild. Change the shared factory or a package-local factory option only when build semantics change. The `files` field is **not** generated: a new non-JS output needs a hand-added `files` entry too, or it is missing from the published tarball.
- Watch builds do not rewrite `package.json`; they skip dts generation and preserve the existing `dist/` contents so the last full build's declarations remain resolvable. Set `SB_WATCH_DTS=true` to generate declarations in watch mode when explicitly needed.
- The `bundler.entries` field in `packages/*/package.json` is dead — nothing in the repo reads it. Never edit it.

## Ported files are tracked in a manifest

`.agents/skills/storybook-check/manifest.json` records the upstream origin of every non-test source file under `packages/builder-rsbuild/src` and `packages/framework-{html,react,vue3,web-components}/src` (field semantics and audit codes: [.agents/skills/storybook-check/SKILL.md](../.agents/skills/storybook-check/SKILL.md)). It carries two obligations, each in the same commit as the code change:

- **File set changes** — adding, renaming, moving, or deleting a file in those trees needs a `mappings` entry or a `localOnlyFiles` entry.
- **Content changes** — editing a mapped file so it deliberately departs from its upstream counterpart needs a line in that mapping's `intentionalDivergences` saying why. The audit diffs file contents, so an undocumented divergence is indistinguishable from a bug; no lint or check command catches it.

Tests, `.stories.`, `.d.ts`, `__tests__/`, `__fixtures__/`, and `__mocks__/` files are exempt. The porting doctrine itself lives in [upstream-port.md](upstream-port.md).

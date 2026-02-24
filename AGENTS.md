# AGENTS.md

## Sub-package Instructions

When working on code in some specific package, use the Read tool to load that package's AGENTS.md file for package-specific guidelines:

- For website: @website/AGENTS.md

### Do

- Use **pnpm** for all package management commands.
- Use **Biome** for formatting and linting (indentation: 2 spaces, single quotes, minimal semicolons).
- Use **Rstest** for unit testing.
- Follow the **kebab-case** convention for directories, filenames, and package names.
- Use explicit `.ts`/`.tsx` extensions.
- Colocate sandbox helpers with their owning packages.
- Update relevant `sandboxes/` when adding or modifying features.

### Don't

- Do not use `npm` or `yarn`.
- Do not use `Prettier` or `ESLint` directly; use `Biome`.
- Do not manually sort imports (Biome handles this).
- Do not introduce new heavy dependencies without approval.
- Do not commit code that fails `pnpm lint` or `pnpm test`.

### Commands

```bash
# Format and lint a single file (preferred)
pnpm exec biome check --write path/to/file.tsx

# Run tests for a single file (preferred)
pnpm exec rstest path/to/file.test.ts

# Run e2e tests for a specific sandbox
pnpm e2e <sandbox>.spec.ts

# Run type checks for all packages
pnpm check

# Run full linting
pnpm lint

# Build all packages (except sandboxes)
pnpm build

# Build sandboxes (integration gate)
pnpm build:sandboxes
```

### Safety and Permissions

**Allowed without prompt:**

- Read files, list files.
- Run `biome check` or `rstest` on single files.
- Create new test files.
- Update existing non-critical code.

**Ask first:**

- `pnpm install` or adding new dependencies.
- `git push`.
- Deleting files or large code blocks.
- Running full project builds (`pnpm build`, `pnpm build:sandboxes`) unless explicitly requested or necessary for validation.

### Project Structure

- **`packages/builder-rsbuild`**: Rsbuild-specific Storybook builder.
- **`packages/addon-rslib`** / **`packages/addon-modernjs`**: Adapter add-ons.
- **`framework-*`**: Renderer packages (HTML, React, Vue3, Web Components). Runtime logic stays in `src/`.
- **`sandboxes/`**: Runnable Storybook apps for regression testing.
- **`website/`**: Documentation (Rspress).
- **`scripts/`**: Shared tooling.

### Testing & Sandbox Workflow

- Write Rstest coverage beside sources using `.test.ts(x)` or within `__tests__/`.
- Use `@testing-library/jest-dom` for DOM assertions.
- **Playwright Debugging**:
  - Use `pnpm e2e <sandbox>.spec.ts` to reproduce locally.
  - Attach Playwright MCP client to inspect the DOM (remember Storybook preview is an iframe).

### Commit & Pull Request Guidelines

- Follow **Conventional Commits**: `feat:`, `fix(builder-rsbuild):`, `chore(deps):`.
- Subject line under 72 characters.
- **PR Checklist**:
  - `pnpm lint` passes.
  - `pnpm build` passes.
  - `pnpm build:sandboxes` passes.
  - Snapshots updated only for intentional changes.

### When Stuck

- Ask a clarifying question.
- Propose a short plan before executing complex refactors.
- Do not push large speculative changes without confirmation.

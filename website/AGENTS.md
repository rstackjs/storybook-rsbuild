# website/AGENTS.md

Rspress v2 docs site (content in `docs/`, React 19 theme components in `theme/`, site config in `rspress.config.ts`).

## Bilingual sync (mandatory)

The site has two locales: English `docs/en` (served at `/`) and Simplified Chinese `docs/zh` (served at `/zh`). The two directories are mirrors — every file in `docs/en` has a counterpart at the same relative path in `docs/zh`, including `_nav.json` and `_meta.json`.

When you add, remove, rename, or edit a doc in one language, make the equivalent change in the other language within the same change. Never leave the trees out of sync. For a removal or rename, ask the user once and name both files in the request (the `docs/en` file and its `docs/zh` counterpart); that single approval covers both — delete/rename them together in the same change.

Translating: keep meaning and structure consistent; leave technical terms, commands, and code blocks unchanged unless localization is required; keep a concise, professional technical-doc style.

- Internal links use the **same path in both locales** (no `/zh` prefix) — Rspress resolves the locale automatically. Example: `/guide/framework/react` in both `en` and `zh`.
- In `_nav.json` / `_meta.json`, translate the human-readable `text` / `label` values; keep `link`, `name`, and structural keys identical across locales.
- Keep directive keywords (`:::info`, `:::tip`, `:::warning`) in English; translate the title text after them.
- `docs/public/` assets are shared by both locales — no counterpart file needed.

## Authoring

- Pages are Markdown/MDX under `docs/{en,zh}/`. The page title is the first `#` heading — no frontmatter needed. Frontmatter is used only for Rspress page-level keys (e.g. `pageType: home` on `docs/*/index.md`).
- Sidebar order and labels live in each directory's `_meta.json`, nav in `_nav.json`. `_meta.json` is **exhaustive** — anything it does not list is silently hidden from the sidebar, and the build raises no warning. A page in a new subdirectory therefore needs two edits per locale: create `<newdir>/_meta.json` listing its pages, _and_ add `{ "type": "dir", "name": "<newdir>", "label": "<Label>" }` to the parent's `_meta.json` (see the `framework` / `integrations` entries in `docs/{en,zh}/guide/_meta.json`).
- Type-checked code blocks: ` ```ts twoslash title=".storybook/main.ts" ` — every `twoslash` block starts with `// @noErrors`: `website` does not depend on `storybook-*-rsbuild` or `@rsbuild/core`, so those imports raise TS2307 and `pnpm --filter website build` fails (`dev` only logs it).

## Commands

```bash
pnpm --filter website dev      # docs dev server
pnpm --filter website build    # build; runs checkDeadLinks — the validation step for doc edits
pnpm --filter website preview  # preview the build
```

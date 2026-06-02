# website/AGENTS.md

### Do
- Use **Rspress (v2)** for documentation.
- Use **React 19** for custom components and UI.
- Use ` ```ts twoslash ` for type-checked code blocks.
- Write standard Markdown or MDX in `docs/`.
- Use YAML frontmatter for metadata (title, sidebar position).
- Keep **English (`docs/en`)** and **Simplified Chinese (`docs/zh`)** docs in sync (see [Bilingual Docs](#bilingual-docs)).

### Don't
- Do not use other documentation frameworks (e.g., Docusaurus, VitePress).
- Do not put content outside of `docs/` unless it's a custom page.
- Do not update one language without updating its counterpart in the same change.

### Commands

```bash
# Start documentation dev server (scoped to website)
pnpm dev

# Build documentation
pnpm build

# Preview build
pnpm preview
```

### Project Structure

- **`docs/en/`**: English Markdown/MDX content (default locale).
- **`docs/zh/`**: Simplified Chinese Markdown/MDX content (mirrors `docs/en`).
- **`docs/public/`**: Static assets shared by all locales.
- **`theme/`**: Custom theme components.
- **`rspress.config.ts`**: Site configuration (locales declared in `themeConfig.locales`).
- **`package.json`**: Dependencies (note `@rspress/*` plugins).

### Bilingual Docs

The site is internationalized with two locales: English at `docs/en` (served at `/`) and
Simplified Chinese at `docs/zh` (served at `/zh`). The two directories are mirrors — every
file in `docs/en` has a counterpart at the same relative path in `docs/zh`, including
`_nav.json` and `_meta.json`.

**Sync rule (mandatory):** when you add, remove, rename, or edit a doc in one language, make
the equivalent change in the other language within the same change. Never leave the trees out
of sync. The workflow:

1. **Identify changes** in both `docs/en` and `docs/zh`.
2. **Translate & synchronize** the counterpart file. Keep meaning and structure consistent;
   leave technical terms, commands, and code blocks unchanged unless localization is required;
   keep a concise, professional technical-doc style.
3. **Validate** with `pnpm build` (it runs `checkDeadLinks`).

Localization conventions:
- Internal links use the **same path in both locales** (no `/zh` prefix) — Rspress resolves
  the locale automatically. Example: `/guide/framework/react` in both `en` and `zh`.
- In `_nav.json` / `_meta.json`, translate the human-readable `text` / `label` values; keep
  `link`, `name`, and structural keys identical across locales.
- Keep directive keywords (`:::info`, `:::tip`, `:::warning`) in English; translate the title
  text after them.

### Writing Documentation

1. **Content**: MDX files in `docs/en` and `docs/zh`.
2. **Frontmatter**:
   ```yaml
   title: My Page
   sidebar_position: 1
   ```
3. **Code Blocks**:
   ````md
   ```ts twoslash
   const a = 1;
   ```
   ````

# AGENTS.md

Package-specific guidance for `storybook-react-lynx-web-rsbuild`. Supplements
the repository-root `AGENTS.md` — only architecture and boundaries unique to
this package live here.

## What this package is

A Storybook **framework** (in Storybook's
builder/renderer/presets sense) that lets users develop ReactLynx components
inside Storybook by rendering them through the `<lynx-view>` web-core
runtime. We are *not* a builder, *not* a renderer, *not* an addon — we are
the glue layer that picks both, registers presets, and threads the user's
own Lynx toolchain through Storybook's dev/build pipeline.

## Composition

The framework is a thin layer over four upstream pieces. Knowing what each
contributes is the fastest way to figure out where a change belongs.

| Layer | Provided by | What it owns |
| --- | --- | --- |
| Builder | `storybook-builder-rsbuild` (workspace) | Bundling preview / manager assets, the dev server, HMR transport |
| Renderer | `@storybook/web-components` | Story decoration, args reactivity, shadow-DOM-friendly default render (we override it but inherit everything else) |
| Compile pipeline | The user's own `@lynx-js/rspeedy` | The actual `.web.bundle` artifact: `pluginReactLynx`, JSX/TSX loader, web env, all of it |
| Runtime | `@lynx-js/web-core` + `@lynx-js/web-elements` | The `<lynx-view>` custom element, WASM mainthread, decode worker |

We pick `@storybook/web-components` as the renderer (not the React renderer)
because the thing on screen is a custom element. The React tree lives
*inside* the Lynx bundle, not in Storybook's React tree.

## Module-resolution boundary: user's rspeedy vs ours

The `@lynx-js/rspeedy` instance we drive **must** be the same module
instance that the user's `pluginReactLynx` was bound to. pnpm can install
multiple rspeedy variants under different peer-dep contexts; importing the
framework's own copy hands us a different instance and the entire React
Lynx loader chain silently no-ops (manifests as JSX parse errors at compile
time).

`importUserRspeedy` in `src/preset.ts` resolves rspeedy from the user's
project root via `import.meta.resolve(specifier, parentURL)`. We rely on the
two-arg form being stable, which is why `engines.node >= 20.6` — and we
cannot fall back to `createRequire().resolve` because rspeedy's
`exports."."` only declares an `import` condition (`createRequire` would
throw `ERR_PACKAGE_PATH_NOT_EXPORTED`).

This boundary is the reason `loadUserRspeedyConfig` deliberately does
*nothing* to the user's config — we trust their plugins, their environment
list, their `output.distPath`, etc.

## Sync vs async preview boundary

`@lynx-js/web-core` uses top-level await (WASM init). Any module that
imports it transitively becomes an async module under rspack. Storybook's
`composeConfigs` reads `render` / `renderToCanvas` synchronously off the
preview module's exports — for an async module, that returns a Promise, the
fields read as `undefined`, and our framework's render silently loses to
the renderer default (the *"component annotation is missing"* error that
new contributors will hit if they ignore this rule).

The package therefore ships **two preview entries** with strictly separated
roles. Treat the boundary as load-bearing:

- `preview.ts` → `./preview` — **sync only**. Exports `render` and
  `renderToCanvas`. Must never gain a side-effect import that pulls TLA in,
  even transitively.
- `preview-runtime.ts` → `./preview-runtime` — async, side-effects only,
  exports nothing. This is where `@lynx-js/web-core` and
  `@lynx-js/web-elements/all` are imported and where the web-elements CSS
  is injected.
- `preset.ts`'s `previewAnnotations` registers `preview-runtime` **before**
  `preview` so the runtime side effects still run while the sync exports
  win `getSingletonField`'s last-pop semantics.
- `build-config.ts` marks `preview-runtime` as `dts: false` because it has
  no type surface.

If a future change needs more preview-time exports, add them to `preview.ts`.
If it needs more runtime side effects, add them to `preview-runtime.ts`.
Never merge the two.

## Two modes of `rsbuildFinal`

A `lynx.config.*` is **mandatory**. If `requireLynxConfig` can't resolve
one, `rsbuildFinal` throws a hard error telling the user to add one. We
looked at all 45 `@lynx-js/react` examples in lynx-family/lynx-examples
and every single one ships a `lynx.config.*`, so a "no-config fallback"
served zero real-world users and the hidden dependency on us keeping our
filename list aligned with rspeedy's `CONFIG_FILES` was a silent-breakage
trap. (Don't resurrect the `staticDirs` fallback — the git history around
commit that removed it explains why.)

Given a config, `rsbuildFinal` forks on `isDev`:

1. **Dev** — in-process rspeedy dev server, fronted by an rsbuild proxy.
   The framework caches a single rspeedy instance keyed off a global
   symbol (concurrent presets share it). CSS rebuilds are detected via
   `hasCssChange(stats)` and broadcast over an SSE channel; JS rebuilds
   intentionally do *not* broadcast, because rsbuild's standard HMR
   client inside the web bundle handles them with state preservation
   (broadcasting would force-reload `<lynx-view>` and clobber that
   state).

2. **Build** — in-process rspeedy build, then `output.copy` into
   Storybook's output. The source directory is taken from
   `rspeedy.context.distPath`, **not** hardcoded as `<projectRoot>/dist`,
   so a user-customized `output.distPath.root` is honored.

`findLynxConfig`'s filename list must stay aligned with rspeedy's
`CONFIG_FILES` in `@lynx-js/rspeedy` core; if they diverge, a user with
e.g. `lynx.config.mts` will get the "no config found" error even though
rspeedy itself would have picked it up.

## Asset hosting boundary

`.web.bundle` is a binary blob whose CSS `url(...)` and image references
are stored as **relative strings** like `static/image/foo.png`. web-core
hands those strings to the shadow DOM unchanged — it does **not** rebase
them against the bundle's fetch URL. The browser then resolves them against
the document (`iframe.html`), so they end up as root-absolute
`/static/image/foo.png` regardless of where the `.web.bundle` itself lives.

Two consequences for our hosting layout:

- `.web.bundle` files are namespaced under `lynx-bundles/` (the user's
  `parameters.lynx.url` points there). We control this prefix.
- `static/**` assets must land at the **output root**, not under
  `lynx-bundles/`. In dev we proxy `/static/{image,font,svg}` to rspeedy;
  in build mode `output.copy` writes them to root. The whitelist is scoped
  to lynx's standard subpaths so it doesn't intercept Storybook's own
  `static/{js,css,wasm}`.

`output.assetPrefix` is **not** a workaround. `LynxTemplatePlugin` runs
`new URL(debugInfoPath, publicPath)` whenever publicPath is a custom string
≠ `'auto'` / `'/'`, and a relative-absolute prefix throws `Invalid URL` at
build time. publicPath has to stay default; the asset layout has to match.

## Where the load-bearing hacks live

The non-obvious workarounds are documented inline at the point of use —
this is just a map so you don't have to grep for them.

- `src/preview.ts` — `createLynxView` element-creation order, the SSE-driven
  CSS reload bridge, the `process.env.NODE_ENV` DCE guard, and the
  `renderToCanvas` reuse path that avoids tearing down the Lynx runtime on
  arg changes. Each has a comment block explaining what breaks if you touch
  it. Read those before editing.
- `src/preset.ts` — `importUserRspeedy` (the `import.meta.resolve` rationale),
  the `callerName` omission in `setupRspeedyDev` (passing it disables
  `pluginReactLynx`'s loader chain), the CSS-only filter in
  `onDevCompileDone`, and `core.builder.options.lazyCompilation = false`
  (lazy compilation hides the wasm-bindgen wasm import in
  `@lynx-js/web-mainthread-apis` behind a lazy-compilation-proxy, so rspack
  never propagates `instantiateWasm` into the worker runtime and
  `__webpack_require__.v` is missing at runtime — production builds work,
  dev crashes with "TypeError: __webpack_require__.v is not a function").

If you find yourself "fixing" something in those areas without first
reading the comment, stop — the comment is the spec.

## External references

- **lynx-stack** (upstream) — https://github.com/lynx-family/lynx-stack.
  When source comments cite a file by repo-relative path (e.g.
  `packages/web-platform/web-core/ts/client/mainthread/LynxView.ts`), they
  mean within that repo. Don't assume any local checkout.
- **rspeedy public API surface** — `packages/rspeedy/core/etc/rspeedy.api.md`
  inside lynx-stack. This is the API Extractor report; consult it before
  guessing types or option shapes for anything passed to `createRspeedy`
  or returned by `loadConfig`.
- **Documentation site** — https://storybook.rsbuild.rs (built from
  `website/` at the repo root).

## Package-specific commands

Things that differ from the repo-root `AGENTS.md`:

```bash
# Rebuild this package only — bundler entries come from build-config.ts
pnpm --filter storybook-react-lynx-web-rsbuild run prep

# Drive the integration sandbox (http://localhost:6010)
pnpm --filter @sandboxes/react-lynx-web storybook
pnpm --filter @sandboxes/react-lynx-web build:storybook
```

When you add or remove an entry under `src/`, **three** files have to move
together: `build-config.ts` (what the bundler emits), `package.json`
`exports` (what Node's resolver will accept), and `package.json`
`bundler.entries`. Forgetting any of them produces silent
"file not in dist" or "subpath not exported" failures downstream.

## Testing / validation

There is no Rstest coverage in this package. Integration is gated through
`sandboxes/react-lynx-web`:

- After editing anything in `src/`, run `pnpm --filter
  storybook-react-lynx-web-rsbuild run prep` first — the framework ships as
  compiled `dist/**` and the sandbox imports from there.
- Then exercise both `pnpm storybook` (dev) and `pnpm build:storybook`
  (build) in the sandbox.
- Smoke check that the sync preview boundary still holds: in the iframe,
  `window.__STORYBOOK_PREVIEW__.storyStore.projectAnnotations.render`
  stringified should reference `parameters?.lynx?.url`. If you see the
  web-components default, something pulled TLA into `preview.ts` and the
  exports are now a Promise.

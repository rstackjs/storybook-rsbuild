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
  exports nothing. This is where `@lynx-js/web-core/client` (which registers
  `<lynx-view>` and injects web-core's own CSS) and `@lynx-js/web-elements/all`
  are imported, and where the `<lynx-view>` sizing style is injected.
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

1. **Dev** — `rsbuildFinal` does almost nothing. The user's rspeedy dev
   server is mounted into Storybook's own http server up in
   `experimental_devServer` (see "Dev server: mount, not proxy" below), so
   the only dev-specific work here is the shared `source.include` +
   `source.define` (the latter also injects `__LYNX_DEV__`, which gates the
   preview's live-reload listener). There is no reverse proxy, no `/static`
   whitelist, no `pathRewrite`, and no SSE reload bridge. Reloads are split by
   edit kind (see "Dev server: mount, not proxy" → "HMR by edit kind"): story
   edits soft-update through Storybook's own preview HMR; component edits
   reload via a main-thread listener on `/lynx-hmr`. The framework still
   caches a single prepared config keyed off a global symbol so the two
   presets share one evaluation.

2. **Build** — in-process rspeedy build, then `output.copy` into
   Storybook's output. The source directory is taken from
   `rspeedy.context.distPath`, **not** hardcoded as `<projectRoot>/dist`,
   so a user-customized `output.distPath.root` is honored. The `static/**`
   copy uses `noErrorOnMissing` so a component library that imports no file
   assets (hence emits no `static/` dir) still builds.

`findLynxConfig`'s filename list must stay aligned with rspeedy's
`CONFIG_FILES` in `@lynx-js/rspeedy` core; if they diverge, a user with
e.g. `lynx.config.mts` will get the "no config found" error even though
rspeedy itself would have picked it up.

## Dev server: mount, not proxy

In dev the user's rspeedy server is **mounted into** Storybook's own http
server rather than run on a separate origin behind a reverse proxy. The
`experimental_devServer` preset hook receives Storybook's `app` (a Polka
server exposing the node http.Server as `.server`) before it starts
listening. `experimental_devServer` then:

1. `createRspeedy({ environment: ['web'] })` from the user's project, adds
   `createMountConfigPlugin()`, and `createDevServer()` in middleware mode.
2. `app.use(devServer.middlewares)` — rspeedy serves the `.web.bundle` and
   its `static/**` assets from the SAME origin as Storybook. Single origin
   means the bundle's relative `static/...` refs resolve against
   `iframe.html` exactly as in build mode — no asset rebasing, no proxy
   whitelist, no `pathRewrite`.
3. `devServer.connectWebSocket({ server: app.server })` — rspeedy's HMR
   socket attaches to Storybook's server on a DISTINCT `/lynx-hmr` path.

Two non-obvious knobs in `createMountConfigPlugin` (set at the rsbuild layer
via `addPlugins` after `createRspeedy`, because rspeedy's `dev.client` only
forwards `websocketTransport`):

- `dev.client.path = '/lynx-hmr'`. rspeedy and Storybook both default their
  HMR socket to `/rsbuild-hmr`; since both attach `upgrade` handlers to the
  one shared `app.server`, they must use disjoint paths. rsbuild's
  `SocketServer.upgrade` *ignores* (does not `destroy`) non-matching paths,
  so disjoint sockets coexist cleanly.
- `dev.client.port = String(options.port)`. The HMR client baked into the
  bundle builds its socket URL as `port = client.port || location.port`.
  rsbuild's config normalization rewrites an *empty* `dev.client.port` to
  `server.port` (rspeedy's own resolved port, e.g. 3000) — a dead port,
  since rspeedy is mounted, not listening there. So we set it explicitly to
  Storybook's resolved listen port. `options.port` is final by the time the
  hook runs (`buildDevStandalone` resolves it via `getServerPort` before
  `storybookDevServer`); `app.server.address()` is still `null` because
  `app.listen()` runs *after* the hook, so `options.port` is the only
  reliable source. When it is somehow absent we leave the port unset and HMR
  live-reload simply won't connect — rendering is unaffected.

This replaces the old design (separate-origin rspeedy + reverse proxy with a
`/static` whitelist, `pathRewrite`, and a bespoke SSE CSS-reload bridge). If
you are tempted to reintroduce a proxy, re-read this section first.

### HMR by edit kind

The mount makes two dev compilers share Storybook's origin: Storybook's own
preview builder and the user's rspeedy `web` build. They reload differently,
and getting *both* right needs two small, load-bearing pieces in
`experimental_devServer` (don't remove either without re-reading this):

- **`*.hot-update.json` bypass.** rsbuild's dev server installs a
  `hotUpdateJsonFallbackMiddleware` that *terminal-404s* any `*.hot-update.json`
  request (it does not `next()`; verified at @rsbuild/core 2.0.9 dist:
  `req.url.endsWith('.hot-update.json') && 'OPTIONS' !== req.method ? notFound :
  next()`). rspeedy's mounted
  copy of it sits in front of the builder's preview middleware, so unguarded it
  shadows the preview compiler's hot-update manifest and Storybook's
  story-level soft HMR can never fetch its update — it falls back to a **full
  page reload on every story edit** (the symptom users notice first). The
  `app.use` wrapper routes `*.hot-update.json` straight past rspeedy to the
  builder. (`*.hot-update.js` is not terminal-404'd — rspeedy's asset
  middleware `next()`s the ones it doesn't own — so it needs no bypass.)
  Verified by contrast: a vanilla storybook-rsbuild sandbox soft-HMRs story
  edits; without this guard the lynx framework full-reloads them.
- **Main-thread `/lynx-hmr` live-reload listener** (`preview-runtime.ts`). A
  *component* source edit rebuilds the `.web.bundle`, which must be re-fetched
  (the `web` target has no React Fast-Refresh). The rsbuild HMR client embedded
  in the bundle runs inside web-core's Worker, where `location.reload` does not
  exist — it *cannot* reload the host iframe (this is why the old "the embedded
  client owns reloads" assumption was wrong). So the framework opens a second,
  read-only client on the **same** mounted `/lynx-hmr` socket from the main
  thread and reloads the iframe when the lynx compilation hash changes
  (`{type:'hash'}`). Reloading only on a *changed* hash means story edits — which
  don't rebuild the bundle — never trigger it, so preview soft HMR stays intact.
  This is not the SSE/proxy bridge the mount replaced: no new server, just a
  listener on the already-mounted socket.
- **`/__lynx_sb_hmr_token__` endpoint.** rsbuild guards `/lynx-hmr` with a
  per-environment `webSocketToken` (`SocketServer.upgrade` `socket.destroy()`s a
  tokenless upgrade), and that token is internal to the bundler context — not on
  rsbuild's public API. So `createMountConfigPlugin` captures it from the
  `modifyBundlerChain` `environment` (exactly where rspeedy's own dev plugin
  reads it) and the mount serves it at this path for the listener to read.

## Asset hosting boundary

`.web.bundle` references its `static/**` assets (CSS `url(...)`, images,
fonts, async chunks) through the build's publicPath. We need those URLs to be
root-relative `/static/image/foo.png` so the browser resolves them against
`iframe.html` on Storybook's origin, regardless of where the bundle lives.

In **build** mode the publicPath defaults to root, so this holds for free. In
**dev**, rspeedy's dev plugin instead defaults `dev.assetPrefix` to its OWN
network origin (`http://<lan-ip>:<port>/`) and bakes that absolute prefix into
every asset URL. Under the mount rspeedy never listens there, so a component
that imports e.g. a `.png` would request it from a dead
`http://<lan-ip>:3000/static/image/...` and get `ERR_CONNECTION_REFUSED` (a
broken image). `createMountConfigPlugin` therefore pins `dev.assetPrefix = '/'`
so dev asset URLs are root-relative too — see the comment there. (This is also
why a component with no assets, like a pure-text button, never surfaced the
bug.)

Two consequences for our hosting layout:

- `.web.bundle` files are namespaced under `lynx-bundles/` (the user's
  `parameters.lynx.url` points there). We control this prefix.
- `static/**` assets must land at the **output root**, not under
  `lynx-bundles/`. In dev the mounted rspeedy middleware serves them from its
  own root (same origin as Storybook); in build mode `output.copy` writes them
  to root (with `noErrorOnMissing`, since an asset-free library emits none).
  The collision surface with Storybook's own emitted files is empty by
  construction: Storybook uses `static/{js,css,wasm}`, lynx uses
  `static/{image,font,svg}`.

A **custom** `output.assetPrefix` string is **not** a workaround.
`LynxTemplatePlugin` runs `new URL(debugInfoPath, publicPath)` whenever
publicPath is a custom string ≠ `'auto'` / `'/'`, and a relative-absolute
prefix throws `Invalid URL` at build time. So the build-mode publicPath stays
default and the asset layout matches; the dev pin above uses `'/'` precisely
because it is the one custom value `LynxTemplatePlugin` allows.

## Where the load-bearing hacks live

The non-obvious workarounds are documented inline at the point of use —
this is just a map so you don't have to grep for them.

- `src/preview.ts` — `createLynxView`'s set-`url`-attribute-*before*-append
  ordering (works around the upstream LynxView `#rendering` latch that
  otherwise leaves the first story blank), the **async** `renderToCanvas`
  gated on `customElements.whenDefined('lynx-view')` (works around the
  web-core property-upgrade race that otherwise drops story args on a second
  page load), and the `updateGlobalProps` reuse path that avoids tearing down
  the Lynx runtime on arg changes. Each has a comment block explaining what
  breaks if you touch it. Read those before editing.
- `src/preview-runtime.ts` — the main-thread `/lynx-hmr` live-reload listener
  (see "Dev server: mount, not proxy" → "HMR by edit kind"): reloads the iframe
  on a changed lynx compilation hash because the bundle's own HMR client (in
  web-core's Worker) cannot. Gated on `__LYNX_DEV__` so production output never
  opens a socket; reads its token from `/__lynx_sb_hmr_token__`.
- `src/preset.ts` — `importUserRspeedy` (the `import.meta.resolve` rationale),
  the `experimental_devServer` mount and `createMountConfigPlugin` knobs (see
  "Dev server: mount, not proxy" — the `/lynx-hmr` path, the `options.port`
  threading, the `*.hot-update.json` bypass, and the `webSocketToken` capture +
  `/__lynx_sb_hmr_token__` endpoint), `output.publicPath = '/'` in `rsbuildFinal` (web-core's worker
  `importScripts` shared chunks BY NAME; an empty publicPath makes them 404 at
  a doubled `/static/js/async/static/js/…` path and the worker never boots —
  `output.workerPublicPath` alone is NOT honored, the worker inherits
  `output.publicPath`), and `core.builder.options.lazyCompilation = false`
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

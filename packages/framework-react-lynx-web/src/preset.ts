import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { mergeRsbuildConfig } from '@rsbuild/core'
import type { PresetProperty } from 'storybook/internal/types'
import type { FrameworkOptions, StorybookConfig } from './types'

/**
 * Minimal slice of Storybook's `Options` this preset's shared helpers use.
 * Typed locally rather than imported because the dependency tree resolves
 * more than one `storybook` version (the builder/renderer allow a `^` range,
 * so `BuilderOptions` ties `StorybookConfig` to a different copy than a direct
 * `Options` import would). Importing `Options` would pin these helpers to ONE
 * copy and clash at the call site that flows the other (`rsbuildFinal`'s
 * `options` vs `experimental_devServer`'s). Structural typing over the two
 * fields we actually read sidesteps that entirely.
 */
type FrameworkSpec =
  | string
  | { name?: string; options?: FrameworkOptions | undefined }
interface PresetOptions {
  configDir: string
  configType?: string | undefined
  /**
   * The dev server's resolved listen port. Storybook resolves a free port via
   * `getServerPort` and reassigns `options.port` to it in `buildDevStandalone`
   * BEFORE `storybookDevServer` runs, so by the time `experimental_devServer`
   * fires this is the final port the http server will bind. (The socket itself
   * isn't listening yet at hook time — `app.listen()` runs *after* the hook —
   * so `app.server.address()` is still null; `options.port` is the only
   * reliable source.) Undefined in non-standard embeddings; the mount path
   * degrades gracefully (see `createMountConfigPlugin`).
   */
  port?: number | undefined
  presets: { apply(name: 'framework'): Promise<FrameworkSpec> }
}

/**
 * Minimal slice of Storybook's `ServerApp` (the Polka app passed to the
 * `experimental_devServer` hook) that the mount path touches. Typed locally
 * for the same multi-version reason as `PresetOptions`.
 */
interface MountServerApp {
  /** The underlying node http server, available at hook time. */
  server?: unknown
  use(handler: unknown): unknown
}

/**
 * Resolve `@lynx-js/rspeedy` from the user's project, not from the framework's
 * own node_modules. This matters because pnpm can install multiple rspeedy
 * variants under different peer-dep contexts; the user's `pluginReactLynx`
 * (and the rest of their lynx.config) is bound to the rspeedy instance in
 * THEIR project. If we imported the framework's own copy we would get a
 * different module instance and the React Lynx loader/plugin chain would
 * silently no-op (manifesting as JSX parse errors).
 *
 * Note: `createRequire(...).resolve('@lynx-js/rspeedy')` would fail with
 * `ERR_PACKAGE_PATH_NOT_EXPORTED` because the package's `exports."."`
 * defines only an `import` condition (no `require`). That's why we use the
 * two-arg form of `import.meta.resolve`, which walks the ESM resolver from
 * the user's project root — stable since Node 20.6 (engines.node enforces).
 */
async function importUserRspeedy(
  projectRoot: string,
): Promise<typeof import('@lynx-js/rspeedy')> {
  const parentUrl = pathToFileURL(join(projectRoot, 'package.json')).href
  const entryUrl = import.meta.resolve('@lynx-js/rspeedy', parentUrl)
  return import(entryUrl)
}

export const previewAnnotations: PresetProperty<'previewAnnotations'> = async (
  input = [],
) => {
  // Order matters: `preview-runtime` is async (top-level await from
  // @lynx-js/web-core's WASM init) and contributes no annotations, while
  // `preview` is sync and contributes `render` / `renderToCanvas`. Both are
  // appended AFTER the renderer's defaults so our render wins composeConfigs.
  // See the long note at the top of src/preview.ts for background.
  return [
    ...input,
    fileURLToPath(import.meta.resolve('./preview-runtime')),
    fileURLToPath(import.meta.resolve('./preview')),
  ]
}

export const core: PresetProperty<'core'> = async (config, options) => {
  const framework = await options.presets.apply('framework')
  const builderOptions =
    typeof framework === 'string' ? {} : framework.options.builder || {}

  return {
    ...config,
    builder: {
      name: fileURLToPath(import.meta.resolve('storybook-builder-rsbuild')),
      // Disable lazyCompilation by default.
      //
      // Why: `@lynx-js/web-core` spawns a Web Worker that dynamically imports a
      // wasm-bindgen wasm module (the mainthread runtime). Rspack processes
      // that wasm import via `experiments.asyncWebAssembly` (on by default in
      // rspack 1.x+) and generates a call to the runtime helper
      // `__webpack_require__.v(...)` — the async wasm loader. (The exact
      // worker/module names live under `@lynx-js/web-core`'s dist and shift
      // between versions, so they're intentionally not pinned here — the
      // rspack-level mechanism below is what matters.)
      //
      // Builder-rsbuild enables lazy compilation in dev with
      // `{ entries: false }` (entries eager, dynamic imports lazy). With lazy
      // compilation, the wasm-bearing chunk sits behind a
      // `lazy-compilation-proxy` at initial compile time, so rspack doesn't
      // propagate the async-wasm runtime requirement into the worker's initial
      // runtime — `__webpack_require__.v` is therefore NEVER installed in the
      // worker. Later, when the worker actually requests the lazy chunk and
      // tries to instantiate wasm, it crashes with:
      //   TypeError: __webpack_require__.v is not a function
      //
      // Production builds don't lazy-compile, so the runtime requirement is
      // computed normally and the helper is installed — which is why
      // `storybook build` works but `storybook dev` does not.
      //
      // The preview iframe for a component library is small enough that the
      // DX cost of eager compilation is negligible. Users can still opt back
      // in via `framework.options.builder.lazyCompilation` if they need it.
      options: {
        lazyCompilation: false,
        ...builderOptions,
      },
    },
    renderer: fileURLToPath(
      import.meta.resolve('@storybook/web-components/preset'),
    ),
  }
}

function resolveProjectRoot(configDir: string): string {
  return resolve(configDir, '..')
}

/**
 * Synthetic entry key under which the dispatcher file gets registered in
 * rspeedy's `source.entry`. Exposed as a constant because both the preset
 * injection and the `__LYNX_STORYBOOK_ENTRY__` URL computation need it.
 * The leading/trailing underscores make an accidental collision with a
 * user-authored entry name extremely unlikely.
 */
const STORYBOOK_ENTRY_KEY = '__storybook__'

/**
 * WebSocket path for the mounted rspeedy dev server's HMR client. rsbuild's
 * default is `/rsbuild-hmr` — the SAME path Storybook's own preview HMR
 * socket uses. Since both dev servers attach their `upgrade` handler to the
 * one shared `app.server`, they must listen on DISJOINT paths or one will
 * `socket.destroy()` the other's clients. rsbuild's `SocketServer.upgrade`
 * starts with `if (!this.wsServer.shouldHandle(req)) return` (an *ignore*,
 * not a destroy) for non-matching paths, so disjoint paths coexist cleanly.
 * See packages/framework-react-lynx-web/CLAUDE.md.
 */
const LYNX_HMR_PATH = '/lynx-hmr'

/**
 * Path of a tiny dev-only endpoint the mount serves so the preview's
 * main-thread live-reload listener can learn the lynx environment's rsbuild
 * `webSocketToken`. rsbuild guards the `/lynx-hmr` socket with that token
 * (`SocketServer.upgrade` calls `socket.destroy()` for a missing/mismatched
 * `?token=`), and the token is internal to the bundler context — not on
 * rsbuild's public API surface — so the framework captures it at build time
 * (see `createMountConfigPlugin`) and hands it to the preview through this
 * endpoint. Kept in sync with `preview-runtime.ts`. */
const LYNX_HMR_TOKEN_PATH = '/__lynx_sb_hmr_token__'

/**
 * Discover a user-authored Storybook dispatcher file under `configDir`.
 * Mirrors Storybook's own `.storybook/preview.*` convention so zero config
 * is needed in the common case.
 */
const STORYBOOK_PREVIEW_NAMES = [
  'lynx-preview.tsx',
  'lynx-preview.ts',
  'lynx-preview.jsx',
  'lynx-preview.js',
] as const

function findStorybookPreviewFile(configDir: string): string | undefined {
  for (const name of STORYBOOK_PREVIEW_NAMES) {
    const abs = resolve(configDir, name)
    if (existsSync(abs)) return abs
  }
  return undefined
}

function findLynxConfig(
  projectRoot: string,
  configPath?: string,
): string | undefined {
  if (configPath) {
    const abs = resolve(projectRoot, configPath)
    return existsSync(abs) ? abs : undefined
  }

  // Keep this list aligned with rspeedy's own auto-discovery in
  // packages/rspeedy/core/src/config/loadConfig.ts (CONFIG_FILES). If they
  // diverge, a user with `lynx.config.mts` will get the "no config found"
  // error below even though rspeedy itself would have picked it up.
  for (const name of [
    'lynx.config.ts',
    'lynx.config.js',
    'lynx.config.mts',
    'lynx.config.mjs',
  ]) {
    const abs = join(projectRoot, name)
    if (existsSync(abs)) return abs
  }
  return undefined
}

/**
 * Resolve the user's `lynx.config.*`. Missing config is a hard error:
 * 100% of `@lynx-js/react` examples in lynx-family/lynx-examples ship a
 * `lynx.config.*`, so there is no real-world "no-config" path for us to
 * support. Do not resurrect a `staticDirs` fallback — its config-filename
 * whitelist would have to be kept manually in sync with rspeedy's own
 * `CONFIG_FILES`, which is a silent-breakage trap.
 */
function requireLynxConfig(
  projectRoot: string,
  configPath: string | undefined,
): string {
  const resolved = findLynxConfig(projectRoot, configPath)
  if (resolved) return resolved
  throw new Error(
    `[storybook-react-lynx-web-rsbuild] No lynx.config.{ts,js,mts,mjs} ` +
      `found at ${projectRoot}. Create one that invokes ` +
      `\`pluginReactLynx()\` and re-run Storybook. If your config lives ` +
      `elsewhere, pass \`framework.options.lynxConfigPath\` in your ` +
      `.storybook/main.ts.`,
  )
}

/**
 * Normalize a user-supplied URL prefix for the **build**-mode bundle layout:
 * leading slash, no trailing slash (`/lynx-bundles`). Build mode copies
 * `.web.bundle` files under this prefix; `output.copy.to` wants the relative
 * form (without the leading slash). In dev the mounted rspeedy server serves
 * bundles from its own root, so the prefix does not apply there.
 */
function normalizeBundlePrefix(raw: string | undefined): string {
  const value = (raw ?? '/lynx-bundles').trim() || '/lynx-bundles'
  const withLeading = value.startsWith('/') ? value : `/${value}`
  return withLeading.endsWith('/') && withLeading.length > 1
    ? withLeading.slice(0, -1)
    : withLeading
}

interface PreparedConfig {
  projectRoot: string
  /** Build-mode bundle URL prefix (see `normalizeBundlePrefix`). */
  bundlePrefix: string
  /** Whether a `.storybook/lynx-preview.*` dispatcher file was found. */
  hasDispatcher: boolean
  /**
   * The rspeedy config with the synthetic dispatcher entry injected (a
   * shallow clone — the user's object is never mutated). Used unchanged by
   * both the dev mount (`experimental_devServer`) and the build path
   * (`runRspeedyBuild`).
   */
  compileConfig: unknown
}

interface RspeedyState {
  /**
   * Memoized config preparation, keyed by `configDir`. Loading the user's
   * `lynx.config.*` runs it through jiti and is not free, so both presets
   * (`experimental_devServer` and `rsbuildFinal`) share one evaluation.
   */
  prepared: Map<string, Promise<PreparedConfig>>
  /** configDirs whose rspeedy dev server has already been mounted. */
  mounted: Set<string>
}

const RSPEEDY_STATE_KEY = Symbol.for(
  'storybook-react-lynx-web-rsbuild.rspeedy.state',
)

function getRspeedyState(): RspeedyState {
  const g = globalThis as unknown as Record<symbol, RspeedyState>
  if (!g[RSPEEDY_STATE_KEY]) {
    g[RSPEEDY_STATE_KEY] = { prepared: new Map(), mounted: new Set() }
  }
  return g[RSPEEDY_STATE_KEY]
}

/**
 * Load the user's rspeedy config. We deliberately do nothing to it here
 * beyond reading — the `environment: ['web']` filter (passed to
 * `createRspeedy`) is what scopes compilation to the web bundle. The only
 * mutation we ever make is injecting the dispatcher entry, and that happens
 * on a shallow clone in `injectStorybookEntry`.
 */
async function loadUserRspeedyConfig(
  projectRoot: string,
  lynxConfigPath: string,
) {
  const { loadConfig } = await importUserRspeedy(projectRoot)
  const { content } = await loadConfig({
    cwd: projectRoot,
    configPath: lynxConfigPath,
  })
  return content
}

/**
 * The framework compiles ONLY the `web` environment (see
 * `createRspeedy({ environment: ['web'] })`); `pluginReactLynx` keys its web
 * output on that exact environment name. If the user's lynx.config declares an
 * `environments` map without a `web` key, `createRspeedy` would fail deep
 * inside rsbuild with an opaque error — so we surface a branded, actionable
 * one here instead. A config with no `environments` block — or an empty `{}`
 * one — is left untouched: rsbuild gates environment processing on
 * `Object.keys(environments).length > 0` (dist 756.js) and synthesizes a
 * default web environment for both, so neither is a misconfiguration.
 */
function assertWebEnvironment(rspeedyConfig: unknown): void {
  const environments = (
    rspeedyConfig as { environments?: Record<string, unknown> } | undefined
  )?.environments
  if (
    environments &&
    typeof environments === 'object' &&
    Object.keys(environments).length > 0 &&
    !('web' in environments)
  ) {
    // Guarded by `length > 0` above, so this is always non-empty.
    const names = Object.keys(environments).join(', ')
    throw new Error(
      `[storybook-react-lynx-web-rsbuild] Your lynx config declares ` +
        `environments { ${names} } but none named \`web\`. This framework ` +
        `renders the web target, so add \`environments: { web: {} }\` to your ` +
        `lynx.config and re-run Storybook.`,
    )
  }
}

/**
 * Inject the dispatcher file as a synthetic `__storybook__` entry into a
 * COPY of the user's rspeedy config. The original config object is never
 * mutated (shallow-cloned down to `source.entry`), so re-reads stay pristine.
 *
 * rspeedy/rspack collapse the app-level `source.entry` forms (`string` /
 * `string[]`) to the implicit name `main`. We mirror that rule and preserve
 * the user's entry under `main` rather than throwing — the dispatcher just
 * needs to live alongside it in record form. After this, the synthetic entry
 * compiles like any other rspeedy entry (`pluginReactLynx`'s JSX/TSX loader,
 * web env, asset handling) and emits `__storybook__.web.bundle`, which
 * `parameters.lynx.component` points at via `__LYNX_STORYBOOK_ENTRY__`.
 */
function injectStorybookEntry(
  rspeedyConfig: unknown,
  dispatcherPath: string,
): unknown {
  const config = { ...(rspeedyConfig as Record<string, unknown>) }
  const source = {
    ...((config.source as Record<string, unknown> | undefined) ?? {}),
  }
  const existing = source.entry

  if (existing == null) {
    source.entry = { [STORYBOOK_ENTRY_KEY]: dispatcherPath }
  } else if (typeof existing === 'string' || Array.isArray(existing)) {
    source.entry = { main: existing, [STORYBOOK_ENTRY_KEY]: dispatcherPath }
  } else {
    source.entry = {
      ...(existing as Record<string, unknown>),
      [STORYBOOK_ENTRY_KEY]: dispatcherPath,
    }
  }

  config.source = source
  return config
}

async function getFrameworkOptions(
  options: PresetOptions,
): Promise<FrameworkOptions> {
  const framework = await options.presets.apply('framework')
  return typeof framework === 'string' ? {} : framework.options || {}
}

/**
 * Load + prepare the user's rspeedy config once per `configDir`, memoized on
 * the shared global state. Returns the project root, the build-mode bundle
 * prefix, whether a dispatcher file exists, and the compile-ready config
 * (with the synthetic entry injected when a dispatcher is present).
 */
async function prepareConfig(options: PresetOptions): Promise<PreparedConfig> {
  const state = getRspeedyState()
  const key = options.configDir
  let cached = state.prepared.get(key)
  if (!cached) {
    cached = (async () => {
      const frameworkOptions = await getFrameworkOptions(options)
      const projectRoot = resolveProjectRoot(options.configDir)
      const bundlePrefix = normalizeBundlePrefix(
        frameworkOptions.lynxBundlePrefix,
      )
      const lynxConfigPath = requireLynxConfig(
        projectRoot,
        frameworkOptions.lynxConfigPath,
      )
      const rspeedyConfig = await loadUserRspeedyConfig(
        projectRoot,
        lynxConfigPath,
      )
      assertWebEnvironment(rspeedyConfig)
      const dispatcherPath = findStorybookPreviewFile(options.configDir)
      const compileConfig = dispatcherPath
        ? injectStorybookEntry(rspeedyConfig, dispatcherPath)
        : rspeedyConfig
      return {
        projectRoot,
        bundlePrefix,
        hasDispatcher: Boolean(dispatcherPath),
        compileConfig,
      }
    })()
    state.prepared.set(key, cached)
  }
  return cached
}

/**
 * A tiny rsbuild plugin that adjusts the few server knobs rspeedy's narrowed
 * config surface does not expose, so the rspeedy dev server can be mounted
 * INTO Storybook's own http server rather than fronted by a proxy:
 *
 *   - `dev.client.path`: move rspeedy's HMR WebSocket off the default
 *     `/rsbuild-hmr` (which collides with Storybook's preview HMR socket on
 *     the shared `app.server`) to `/lynx-hmr`. See `LYNX_HMR_PATH`.
 *   - `server.htmlFallback: false`: the lynx web build emits no host HTML, so
 *     this only ever risks intercepting Storybook's `/iframe.html`. Off it.
 *   - `server.printUrls: false`: the mounted server never listens on its own
 *     origin, so its URL banner would be misleading.
 *
 * rspeedy's `dev.client` only forwards `websocketTransport`, which is why
 * `dev.client.path` has to be set at the rsbuild layer via `addPlugins`
 * AFTER `createRspeedy` (the config-loading hook still runs before
 * `createDevServer` resolves the config).
 *
 * The plugin is typed against a local minimal interface (not our
 * `RsbuildPlugin`) and cast at the `addPlugins` boundary: it is handed to the
 * USER's rspeedy instance, resolved from THEIR project at runtime, whose
 * `@rsbuild/core` is a different module instance (and may be a different
 * version) than the one this package compiled against.
 */
interface MountConfigPlugin {
  name: string
  setup(api: {
    modifyRsbuildConfig(
      fn: (config: {
        dev?: {
          assetPrefix?: string | boolean
          client?: { path?: string; host?: string; port?: string }
        }
        server?: { htmlFallback?: boolean; printUrls?: boolean }
      }) => unknown,
    ): void
    modifyBundlerChain(
      fn: (
        chain: unknown,
        utils: { environment?: { name?: string; webSocketToken?: string } },
      ) => void,
    ): void
  }): void
}

function createMountConfigPlugin(
  storybookPort: number | undefined,
  onWebSocketToken: (token: string | undefined) => void,
): MountConfigPlugin {
  return {
    name: 'storybook-lynx:mount-config',
    setup(api) {
      // Capture the lynx (web) environment's rsbuild `webSocketToken` so the
      // mount can expose it to the preview's main-thread `/lynx-hmr` listener
      // (see `LYNX_HMR_TOKEN_PATH`). This is exactly where rspeedy's own dev
      // plugin reads it to bake into the bundle's HMR client, so it is
      // populated by the time the bundler chain runs.
      api.modifyBundlerChain((_chain, { environment }) => {
        onWebSocketToken(environment?.webSocketToken)
      })
      api.modifyRsbuildConfig((config) => {
        // These knobs are FRAMEWORK-OWNED under the mount model and are set
        // unconditionally on purpose — do NOT relax them to `??=` to "respect"
        // a user value. A user's `dev.client.{host,port,path}` describe THEIR
        // standalone rspeedy dev origin; here rspeedy is mounted into
        // Storybook's server and never listens on that origin, so honoring a
        // stale host/port/path would point the HMR socket at a dead address
        // (the exact regression an `??=` "fix" would introduce). Likewise
        // `server.htmlFallback`/`printUrls` only make sense for a standalone
        // listener. The framework controls them; the user's own values apply
        // when they run `rspeedy dev` directly, not under Storybook.
        config.dev ??= {}
        // rspeedy's dev plugin defaults `dev.assetPrefix` to its own network
        // origin (`http://<lan-ip>:<port>/`), and bakes that absolute prefix
        // into the bundle's asset URLs (images, fonts, async chunks) and HMR
        // hot-update fetches. Under the mount rspeedy never listens on that
        // origin, so a component that imports e.g. a `.png` requests it from a
        // dead `http://<lan-ip>:3000/static/image/...` and gets
        // ERR_CONNECTION_REFUSED (a blank/broken asset). Pin it to root so
        // those URLs become `/static/...` and resolve against `iframe.html` on
        // Storybook's origin — the same layout build mode produces, and the
        // asset-URL analog of the `dev.client.{host,port}` fix below. `'/'` is
        // the one custom publicPath `LynxTemplatePlugin` allows (see the
        // "Asset hosting boundary" note in CLAUDE.md), so it is safe here.
        config.dev.assetPrefix = '/'
        config.dev.client ??= {}
        config.dev.client.path = LYNX_HMR_PATH
        // The HMR client baked into the `.web.bundle` builds its WebSocket URL
        // as `host = client.host || location.hostname` and
        // `port = client.port || location.port` (see @rsbuild/core
        // dist/client/hmr.js `formatURL`). rspeedy never listens on its own
        // origin here — it's mounted into Storybook's server — so the client
        // must target Storybook's origin instead.
        //
        // host: left empty so it derives from `location.hostname` (whatever
        // host the user opened the preview on). rsbuild does NOT rewrite an
        // empty client host, so this falls through correctly.
        config.dev.client.host = ''
        // port: we CANNOT leave this empty to fall through to `location.port`,
        // because rsbuild normalizes `!dev.client.port` to `server.port` (its
        // own resolved port, e.g. 3000) before baking the client config
        // (@rsbuild/core dist config-normalization: `config.server?.port &&
        // !config.dev.client?.port && (config.dev.client.port =
        // config.server.port)`). That dead port would make the HMR socket
        // dial 3000 where nothing listens. Setting it explicitly to
        // Storybook's resolved port skips that normalization and points the
        // socket at the origin where `/lynx-hmr` is actually mounted. When the
        // port is unknown (non-standard embedding) we leave it unset and let
        // the normalization run — HMR live-reload won't connect, but rendering
        // is unaffected.
        if (storybookPort != null) {
          config.dev.client.port = String(storybookPort)
        }
        config.server ??= {}
        config.server.htmlFallback = false
        config.server.printUrls = false
        return config
      })
    },
  }
}

/**
 * Mount the user's rspeedy dev server into Storybook's own dev server.
 *
 * This is the heart of the dev-mode architecture. Instead of running rspeedy
 * on a separate origin and reverse-proxying selected paths (the old design,
 * with its `pathRewrite` regex, `/static/*` whitelist, and bespoke SSE
 * reload bridge), we drive rspeedy in rsbuild's middleware mode and graft its
 * middleware stack + HMR WebSocket directly onto Storybook's `app`:
 *
 *   - `app.use(devServer.middlewares)` — rspeedy serves its emitted assets
 *     (`__storybook__.web.bundle`, `static/{image,font,svg}/**`, `.rspeedy`
 *     intermediates) from the SAME origin as Storybook. Single origin means
 *     the bundle's relative `static/...` references resolve against
 *     `iframe.html` exactly as they do in build mode — no asset rebasing,
 *     no proxy whitelist. Requests rspeedy doesn't own fall through to
 *     Storybook's own middleware (manager, `/iframe.html`, `/static/js`).
 *   - `connectWebSocket({ server: app.server })` — rspeedy's HMR client
 *     (embedded in the `.web.bundle` by rsbuild core for the `web` target)
 *     connects back over Storybook's http server on the distinct
 *     `/lynx-hmr` path. On rebuild it triggers a full reload of the bundle.
 *
 * The mounted server is created with `environment: ['web']` and NO
 * `callerName` (passing `callerName` disables `pluginReactLynx`'s loader
 * chain — see `importUserRspeedy`). We block on the first compile so the
 * `.web.bundle` exists before Storybook finishes starting and a story can
 * request it.
 */
export const experimental_devServer = async (
  app: MountServerApp,
  options: PresetOptions,
): Promise<MountServerApp> => {
  const state = getRspeedyState()
  if (state.mounted.has(options.configDir)) return app
  state.mounted.add(options.configDir)

  const { projectRoot, compileConfig } = await prepareConfig(options)
  const { createRspeedy } = await importUserRspeedy(projectRoot)

  const rspeedy = await createRspeedy({
    cwd: projectRoot,
    rspeedyConfig: compileConfig as Parameters<
      typeof createRspeedy
    >[0]['rspeedyConfig'],
    environment: ['web'],
  })
  // Cast: the plugin targets the user's runtime-resolved rspeedy/@rsbuild
  // instance (see `createMountConfigPlugin`). `options.port` is Storybook's
  // resolved listen port, threaded into the bundle's HMR client so it dials
  // Storybook's origin (where `/lynx-hmr` is mounted) rather than rspeedy's
  // dead default port. The callback captures the lynx env's `webSocketToken`
  // (populated during the bundler chain) so the preview's main-thread
  // live-reload listener can authenticate to `/lynx-hmr` (see
  // `LYNX_HMR_TOKEN_PATH`).
  let hmrToken: string | undefined
  rspeedy.addPlugins([
    createMountConfigPlugin(options.port, (token) => {
      hmrToken = token
    }),
  ] as unknown as Parameters<typeof rspeedy.addPlugins>[0])

  const devServer = await rspeedy.createDevServer()

  // Serve the captured `webSocketToken` to the preview's main-thread
  // live-reload listener. The handler reads `hmrToken` at request time (the
  // preview fetches it after the dev server is up), so it does not matter that
  // the token is captured asynchronously during the first compile below.
  app.use(
    (
      req: { url?: string },
      res: {
        setHeader(k: string, v: string): void
        end(body?: string): void
      },
      next: (err?: unknown) => void,
    ) => {
      if (req.url !== LYNX_HMR_TOKEN_PATH) {
        next()
        return
      }
      res.setHeader('content-type', 'text/plain')
      res.setHeader('cache-control', 'no-store')
      res.end(hmrToken ?? '')
    },
  )

  const waitFirstCompile = new Promise<void>((resolve) => {
    rspeedy.onDevCompileDone(({ isFirstCompile }) => {
      if (isFirstCompile) resolve()
    })
  })

  // rspeedy's mounted dev middleware sits IN FRONT of
  // `storybook-builder-rsbuild`'s own preview dev middleware (this hook runs
  // before the builder registers its middleware on the shared Polka `app`).
  // rsbuild's dev server installs a `hotUpdateJsonFallbackMiddleware` that
  // *terminal-404s* any `*.hot-update.json` request — verified at @rsbuild/core
  // 2.0.9 dist: `req.url.endsWith('.hot-update.json') && 'OPTIONS' !==
  // req.method ? notFound : next()` — so
  // rspeedy's mounted copy of it shadows the PREVIEW compiler's hot-update
  // manifest: Storybook's story-level soft HMR can never fetch its update and
  // falls back to a full page reload on every `*.stories.*` edit (the
  // user-visible "flash"). So we route `*.hot-update.json` straight past
  // rspeedy to the builder, which owns the preview HMR that actually works.
  // (`*.hot-update.js` is NOT terminal-404'd — rspeedy's asset middleware
  // `next()`s the ones it doesn't own — so it needs no bypass.) The lynx
  // `.web.bundle` can't hot-apply on the web target anyway (web-core has no
  // React Fast-Refresh); component edits live-reload over the `/lynx-hmr`
  // socket instead. This is the HTTP analog of the `/lynx-hmr`
  // WebSocket-path split above.
  const lynxMiddlewares = devServer.middlewares as unknown as (
    req: { url?: string },
    res: unknown,
    next: (err?: unknown) => void,
  ) => void
  app.use(
    (req: { url?: string }, res: unknown, next: (err?: unknown) => void) => {
      // Mirror rsbuild's own bare `endsWith` check — real hot-update requests
      // carry no query string, so no URL normalization is needed.
      if (req.url?.endsWith('.hot-update.json')) {
        next()
        return
      }
      lynxMiddlewares(req, res, next)
    },
  )
  if (app.server) {
    // Cast: `app.server` is Storybook's node http server; rspeedy's
    // `connectWebSocket` types it from its own (foreign) `@rsbuild/core`.
    devServer.connectWebSocket({
      server: app.server as Parameters<
        typeof devServer.connectWebSocket
      >[0]['server'],
    })
  }

  await waitFirstCompile
  await devServer.afterListen()
  return app
}

/**
 * Run an in-process rspeedy production build that emits `.web.bundle`
 * artifacts into the project's resolved dist directory. Returns that dir so
 * callers copy from the right location instead of hardcoding
 * `<projectRoot>/dist`. `compileConfig` already carries the synthetic
 * dispatcher entry (see `injectStorybookEntry`).
 */
async function runRspeedyBuild(
  projectRoot: string,
  compileConfig: unknown,
): Promise<string> {
  const { createRspeedy } = await importUserRspeedy(projectRoot)

  console.log('[lynx] Building Lynx components...')
  const rspeedy = await createRspeedy({
    cwd: projectRoot,
    rspeedyConfig: compileConfig as Parameters<
      typeof createRspeedy
    >[0]['rspeedyConfig'],
    environment: ['web'],
  })
  await rspeedy.build()
  console.log('[lynx] Build complete.')
  // `rspeedy.context.distPath` is the resolved output dir (honors a
  // user-customized `output.distPath.root`). See lynx-stack
  // packages/rspeedy/core/src/create-rspeedy.ts.
  return rspeedy.context.distPath
}

export const rsbuildFinal: StorybookConfig['rsbuildFinal'] = async (
  config,
  options,
) => {
  const { projectRoot, bundlePrefix, hasDispatcher, compileConfig } =
    await prepareConfig(options)

  const isDev = options.configType !== 'PRODUCTION'

  // URL of the dispatcher bundle, or `null` when the user authored no
  // `.storybook/lynx-preview.*` registry. The serving layout differs by mode:
  //   - dev: the mounted rspeedy server serves the bundle from its own root,
  //     so the URL is root-relative (`/__storybook__.web.bundle`).
  //   - build: `output.copy` namespaces bundles under `bundlePrefix`.
  // `null` MUST round-trip through `JSON.stringify` → `"null"`, otherwise
  // DefinePlugin (rspack/webpack) treats a bare `null` define value as "delete
  // this key" and the ambient decl on the preview side reads as `undefined`
  // instead of `null`.
  const storybookEntryUrl = hasDispatcher
    ? isDev
      ? `/${STORYBOOK_ENTRY_KEY}.web.bundle`
      : `${bundlePrefix}/${STORYBOOK_ENTRY_KEY}.web.bundle`
    : null

  // `source.include` forces rsbuild to transpile files inside the
  // `@lynx-js/*` namespace. Those packages ship as ESM whose syntax depends
  // on the host project's target; rsbuild's default `node_modules` exclusion
  // would hand them to the runtime unprocessed and produce "Unexpected token"
  // errors at evaluation time.
  //
  // `source.define` injects the compile-time constants the preview entries
  // read: `__LYNX_STORYBOOK_ENTRY__` (the dispatcher bundle URL or null) and
  // `__LYNX_DEV__` (dev vs production build). No static component list is
  // injected — the dispatcher validates `parameters.lynx.component` against
  // the live registry at runtime and renders a visible unknown-component
  // error itself (see runtime.ts).
  const baseConfig = mergeRsbuildConfig(config, {
    source: {
      include: [/[\\/]node_modules[\\/]@lynx-js[\\/]/],
      define: {
        __LYNX_STORYBOOK_ENTRY__: JSON.stringify(storybookEntryUrl),
        // Gates the dev-only `/lynx-hmr` live-reload listener in
        // `preview-runtime.ts`; `false` in a production build strips it so the
        // static output never opens a socket. See the comment there.
        __LYNX_DEV__: JSON.stringify(isDev),
      },
    },
    tools: {
      // `@lynx-js/web-core` boots its main thread inside a Web Worker that
      // `importScripts()` shared chunks BY NAME (e.g. `static/js/vendors-…`).
      // The preview build's default publicPath is empty, so inside the worker
      // those names resolve relative to the worker script's own directory
      // (`/static/js/async/`) and 404 at a doubled path
      // (`/static/js/async/static/js/vendors-…`) — the worker never boots and
      // `<lynx-view>` stays collapsed at 0×0. Pinning publicPath to the
      // preview root makes both the main thread and the worker resolve chunks
      // from `/static/js/…`. (`output.workerPublicPath` on its own is NOT
      // honored by rspack here — the worker inherits `output.publicPath`.)
      // This assumes the Storybook preview is served from the origin root,
      // which holds in dev and for the default build deployment.
      //
      // Set via the FUNCTION form: an object `tools.rspack` is dropped when
      // merged against the builder's own `tools.rspack`, whereas the function
      // joins that chain and reliably applies.
      rspack: (config) => {
        config.output ??= {}
        config.output.publicPath = '/'
        return config
      },
    },
  })

  // Dev: the rspeedy dev server is already mounted into Storybook's own
  // server by `experimental_devServer`. Nothing else to wire here — just the
  // shared `source.include` + defines above.
  if (isDev) {
    return baseConfig
  }

  // Build: run rspeedy build (in-process), copy bundles into Storybook
  // output as static assets. The source directory comes from
  // `rspeedy.context.distPath` so a user-customized `output.distPath.root`
  // is honored.
  //
  // Copy layout:
  //   - `.web.bundle` files → `lynx-bundles/` (isolated prefix; the dev/build
  //     `__LYNX_STORYBOOK_ENTRY__` URL points here in build mode).
  //   - `static/**` → output root, preserving the `static/` prefix. These
  //     are referenced from inside the bundle as relative paths like
  //     `static/image/foo.png`, which the browser resolves against
  //     `iframe.html` → `/static/image/foo.png`. They MUST land at the
  //     root, not under `lynx-bundles/`, otherwise image/font lookups 404.
  //     (Collisions with Storybook's own emitted files are avoided not by a
  //     structural namespace split — both builders default to the same
  //     `static/*` dirs — but empirically: the lynx web build emits no
  //     `static/{image,font,svg}` assets unless a component imports them, and
  //     every emitted file is content-hashed, so a clash with Storybook's own
  //     `static/js` chunks is effectively impossible.)
  //     `noErrorOnMissing` because a component library that imports no file
  //     assets (e.g. it only takes image URLs as args) emits no `static/`
  //     dir at all, and rspack's copy plugin treats a glob that matches
  //     nothing as a hard error otherwise.
  const rspeedyDistDir = await runRspeedyBuild(projectRoot, compileConfig)

  return mergeRsbuildConfig(baseConfig, {
    output: {
      copy: [
        {
          from: '**/*.web.bundle',
          context: rspeedyDistDir,
          to: `${bundlePrefix.slice(1)}/`,
        },
        {
          from: 'static/**/*',
          context: rspeedyDistDir,
          to: '',
          noErrorOnMissing: true,
        },
      ],
    },
  })
}

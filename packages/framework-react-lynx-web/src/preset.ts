import { existsSync } from 'node:fs'
import type { ServerResponse } from 'node:http'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { mergeRsbuildConfig } from '@rsbuild/core'
import type { PresetProperty } from 'storybook/internal/types'
import type { FrameworkOptions, StorybookConfig } from './types'

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
      // Why: `@lynx-js/web-core` spawns a Web Worker via
      // `new Worker(new URL('@lynx-js/web-worker-runtime', import.meta.url))`.
      // That worker bundle dynamically imports `@lynx-js/web-mainthread-apis`,
      // which in turn imports wasm-bindgen output:
      //   import * as wasm from './standard_bg.wasm'
      // Rspack processes that import via `experiments.asyncWebAssembly` (on by
      // default in rspack 1.x+) and generates a call to the runtime helper
      // `__webpack_require__.v(...)` — the async wasm loader.
      //
      // Builder-rsbuild enables lazy compilation in dev with
      // `{ entries: false }` (entries eager, dynamic imports lazy). With lazy
      // compilation, the wasm-bearing chunk sits behind a
      // `lazy-compilation-proxy` at initial compile time, so rspack doesn't
      // propagate the `instantiateWasm` runtime requirement into the worker's
      // initial runtime — `__webpack_require__.v` is therefore NEVER installed
      // in the worker. Later, when the worker actually requests the lazy chunk
      // and tries to instantiate wasm, it crashes with:
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
  // error above even though rspeedy itself would have picked it up.
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

interface RspeedyState {
  /** http origin of the rspeedy dev server (only set in dev mode). */
  origin?: string
  /** SSE clients listening for rspeedy rebuild reload events. */
  sseClients: ServerResponse[]
  /** Cached promise so concurrent presets share one rspeedy instance. */
  setupPromise?: Promise<void>
}

const CSS_FILE_RE = /\.(?:css|scss|sass|less|styl|stylus)$/i

/**
 * Normalize a user-supplied URL prefix so downstream code can treat it
 * consistently: leading slash, no trailing slash (`/lynx-bundles`). The
 * proxy config needs the leading slash and `pathRewrite` pattern, while
 * `output.copy.to` wants a relative directory without the leading slash.
 * Accepting either form from the user keeps the DX forgiving.
 */
function normalizeBundlePrefix(raw: string | undefined): string {
  const value = (raw ?? '/lynx-bundles').trim() || '/lynx-bundles'
  const withLeading = value.startsWith('/') ? value : `/${value}`
  return withLeading.endsWith('/') && withLeading.length > 1
    ? withLeading.slice(0, -1)
    : withLeading
}

/**
 * Return true if the rebuild's modified file set contains at least one
 * style file. We walk the rspack Stats/MultiStats and collect
 * `compilation.modifiedFiles` (a `ReadonlySet<string>` of absolute paths
 * rspack populated from its watcher before the current rebuild ran). Any
 * source file change that ends in a CSS-family extension counts — TSX/TS
 * edits alone return `false` and let rsbuild's WebSocket HMR handle them.
 *
 * Caveat — this reads an **undocumented internal** rspack Stats field.
 * `compilation.modifiedFiles` has been present and stable in rspack since
 * ~0.5.x, but it is not in `@rspack/core`'s public API surface. If a
 * future rspack rename or removal makes it `undefined`, we fall back to
 * `return false` (never broadcast), which degrades CSS edits to "no
 * auto-reload" — annoying but harmless, because rsbuild's embedded
 * WebSocket HMR client still handles them inside the `.web.bundle`.
 *
 * The **critical** property of this function is that it must return
 * `false` for a pure JS/TSX rebuild. If it returns `true` there, the SSE
 * broadcast fires, `preview.ts` tears down `<lynx-view>`, and the user's
 * interactive state (counter value, form input, etc.) is wiped — the
 * exact opposite of what Fast Refresh is supposed to preserve. Do **not**
 * reintroduce a "reload on unknown" fallback here; see prior regression
 * in the git history.
 */
function hasCssChange(stats: unknown): boolean {
  // Duck-typed against Rspack.Stats | Rspack.MultiStats to avoid a
  // framework-level dependency on @rspack/core just for a type.
  const candidates: unknown[] = []
  const anyStats = stats as {
    stats?: unknown[]
    compilation?: { modifiedFiles?: ReadonlySet<string> }
  }
  if (Array.isArray(anyStats.stats)) {
    candidates.push(...anyStats.stats)
  } else {
    candidates.push(anyStats)
  }
  for (const s of candidates) {
    const modified = (
      s as { compilation?: { modifiedFiles?: ReadonlySet<string> } }
    ).compilation?.modifiedFiles
    if (!modified) continue
    for (const file of modified) {
      if (CSS_FILE_RE.test(file)) return true
    }
  }
  return false
}

const RSPEEDY_STATE_KEY = Symbol.for(
  'storybook-react-lynx-web-rsbuild.rspeedy.state',
)

function getRspeedyState(): RspeedyState {
  const g = globalThis as unknown as Record<symbol, RspeedyState>
  if (!g[RSPEEDY_STATE_KEY]) {
    g[RSPEEDY_STATE_KEY] = { sseClients: [] }
  }
  return g[RSPEEDY_STATE_KEY]
}

/**
 * Load the user's rspeedy config. Stories load `.web.bundle` artifacts via
 * the proxy, so the runtime `environment: ['web']` filter (passed to
 * `createRspeedy`) is sufficient — we don't need to mutate the config.
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
 * Lazily start (or reuse) an in-process rspeedy dev server. Returns the
 * origin URL once the first compile has completed and the server is listening.
 */
async function setupRspeedyDev(
  projectRoot: string,
  lynxConfigPath: string,
): Promise<string> {
  const state = getRspeedyState()
  if (state.origin) return state.origin

  if (!state.setupPromise) {
    state.setupPromise = (async () => {
      const { createRspeedy } = await importUserRspeedy(projectRoot)
      const rspeedyConfig = await loadUserRspeedyConfig(
        projectRoot,
        lynxConfigPath,
      )

      // NOTE: do NOT pass `callerName` — passing it disables rspeedy's
      // default plugin chain (including pluginReactLynx's JSX/TSX loader
      // registration), causing entry compilation to fail with
      // "JavaScript parse error: Expression expected".
      const rspeedy = await createRspeedy({
        cwd: projectRoot,
        rspeedyConfig,
        environment: ['web'],
      })

      // Drive dev reload broadcasts from rspeedy's compiler hook, but only
      // for **CSS-ish** rebuilds. Background-thread JS already has real HMR
      // via rsbuild's standard WebSocket client embedded in the web bundle
      // (pluginReactLynx only skips its own HMR prepends for the `web` env
      // — see lynx-stack packages/rspeedy/plugin-react/src/entry.ts — not
      // rsbuild's normal ones), so broadcasting on every rebuild would
      // force-reload <lynx-view> and clobber the JS HMR's state
      // preservation. CSS edits, on the other hand, have no upstream HMR
      // path: we still need to ping preview.ts so it force-refetches the
      // template via the `?t=` cache-bust (see note in preview.ts).
      rspeedy.onDevCompileDone(({ isFirstCompile, stats }) => {
        if (isFirstCompile) return
        if (!hasCssChange(stats)) return
        for (const client of state.sseClients) {
          client.write('data: content-changed\n\n')
        }
      })

      const { urls, port } = await rspeedy.startDevServer({
        getPortSilently: true,
      })
      const origin = urls[0] ?? `http://localhost:${port}`
      state.origin = origin
      console.log(`[lynx] rspeedy dev server ready at ${origin}`)
    })()
  }

  await state.setupPromise
  return state.origin!
}

/**
 * Run an in-process rspeedy production build that emits .web.bundle
 * artifacts into the project's resolved dist directory. Returns the
 * resolved dist directory so callers can copy from the right location
 * instead of hardcoding `<projectRoot>/dist`.
 */
async function runRspeedyBuild(
  projectRoot: string,
  lynxConfigPath: string,
): Promise<string> {
  const { createRspeedy } = await importUserRspeedy(projectRoot)
  const rspeedyConfig = await loadUserRspeedyConfig(projectRoot, lynxConfigPath)

  console.log('[lynx] Building Lynx components...')
  const rspeedy = await createRspeedy({
    cwd: projectRoot,
    rspeedyConfig,
    environment: ['web'],
  })
  await rspeedy.build()
  console.log('[lynx] Build complete.')
  // `rspeedy.context.distPath` is the resolved output dir (honors a
  // user-customized `output.distPath.root`). See lynx-stack
  // packages/rspeedy/core/src/create-rspeedy.ts:153.
  return rspeedy.context.distPath
}

export const rsbuildFinal: StorybookConfig['rsbuildFinal'] = async (
  config,
  options,
) => {
  const framework = await options.presets.apply('framework')
  const frameworkOptions: FrameworkOptions =
    typeof framework === 'string' ? {} : framework.options || {}

  const projectRoot = resolveProjectRoot(options.configDir)
  const bundlePrefix = normalizeBundlePrefix(frameworkOptions.lynxBundlePrefix)
  // Hard-error if there's no lynx.config — see `requireLynxConfig`.
  const lynxConfig = requireLynxConfig(
    projectRoot,
    frameworkOptions.lynxConfigPath,
  )

  const isDev = options.configType !== 'PRODUCTION'

  // `source.include` forces rsbuild to transpile files inside the
  // `@lynx-js/*` namespace. Those packages ship as ESM with syntax
  // (optional chaining in older target, top-level await, etc.) that
  // depends on the host project's target; rsbuild's default
  // `node_modules` exclusion would hand them to the runtime unprocessed
  // and produce "Unexpected token" errors at evaluation time.
  const baseConfig = mergeRsbuildConfig(config, {
    source: {
      include: [/[\\/]node_modules[\\/]@lynx-js[\\/]/],
    },
  })

  // Dev: in-process rspeedy dev server, proxied via Rsbuild.
  if (isDev) {
    const origin = await setupRspeedyDev(projectRoot, lynxConfig)
    const state = getRspeedyState()

    return mergeRsbuildConfig(baseConfig, {
      server: {
        proxy: {
          [bundlePrefix]: {
            target: origin,
            changeOrigin: true,
            pathRewrite: { [`^${bundlePrefix}`]: '' },
          },
          // Lynx-emitted static assets (images, fonts, svg) are referenced
          // by the .web.bundle as *relative* URLs like `static/image/foo.png`.
          // web-core hands those strings to the DOM unchanged, so the browser
          // resolves them against `iframe.html` (root-absolute), NOT against
          // the bundle URL. We route those specific subpaths to rspeedy's
          // dev server to match how build-mode copies them to the root.
          //
          // Scoped to subpaths lynx actually uses to avoid colliding with
          // storybook's own `/static/js`, `/static/css`, `/static/wasm`,
          // which are served by the rsbuild dev middleware.
          '/static/image': { target: origin, changeOrigin: true },
          '/static/font': { target: origin, changeOrigin: true },
          '/static/svg': { target: origin, changeOrigin: true },
          '/.rspeedy': {
            target: origin,
            changeOrigin: true,
          },
        },
      },
      dev: {
        setupMiddlewares: [
          (middlewares) => {
            // SSE endpoint: preview.ts subscribes for rebuild reload events.
            middlewares.unshift((req, res, next) => {
              if (req.url !== '/__lynx_hmr__') return next()
              res.writeHead(200, {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                Connection: 'keep-alive',
                'Access-Control-Allow-Origin': '*',
              })
              res.write('data: connected\n\n')
              state.sseClients.push(res)
              req.on('close', () => {
                const idx = state.sseClients.indexOf(res)
                if (idx !== -1) state.sseClients.splice(idx, 1)
              })
            })
          },
        ],
      },
    })
  }

  // Build: run rspeedy build (in-process), copy bundles into Storybook
  // output as static assets. The source directory comes from
  // `rspeedy.context.distPath` so a user-customized `output.distPath.root`
  // is honored.
  //
  // Copy layout:
  //   - `.web.bundle` files → `lynx-bundles/` (isolated prefix; user's
  //     `parameters.lynx.url` points here).
  //   - `static/**` → output root, preserving the `static/` prefix. These
  //     are referenced from inside the bundle as relative paths like
  //     `static/image/foo.png`, which the browser resolves against
  //     `iframe.html` → `/static/image/foo.png`. They MUST land at the
  //     root, not under `lynx-bundles/`, otherwise image/font lookups 404.
  //     (The collision surface with storybook's own emitted files is
  //     empty by construction: storybook uses `static/{js,css,wasm}`
  //     while lynx uses `static/{image,font,svg}`.)
  const rspeedyDistDir = await runRspeedyBuild(projectRoot, lynxConfig)

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
        },
      ],
    },
  })
}

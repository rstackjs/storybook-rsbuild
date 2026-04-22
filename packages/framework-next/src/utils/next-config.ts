import { createRequire } from 'node:module'
import { logger } from 'storybook/internal/node-logger'

// Must be set before any Next.js internal imports so that
// getBaseWebpackConfig() emits rspack-compatible config.
process.env.NEXT_RSPACK = 'true'
process.env.RSPACK_CONFIG_VALIDATE = 'loose-silent'
// Prevents Next.js from erroring about missing render worker context
process.env.__NEXT_PRIVATE_RENDER_WORKER = 'defined'

export interface NextRspackExtraction {
  /** resolve.alias from getBaseWebpackConfig (absolute paths) */
  alias: Record<string, string | string[] | false>
  /** top-level resolve.fallback (e.g. `{ process: <polyfill> }`) */
  fallback: Record<string, string | string[] | false>
  /** DefinePlugin definitions (process.env.__NEXT_*, etc.) */
  defines: Record<string, any>
  /** resolveLoader configuration */
  resolveLoader: Record<string, any>
  /** Raw module rules from getBaseWebpackConfig (client, dev). */
  rawRules: any[]
  /** Raw plugin instances from getBaseWebpackConfig (client, dev). */
  rawPlugins: any[]
}

const req = createRequire(import.meta.url)

let cachedVersion: [number, number] | null | undefined

/**
 * `[major, minor]` of the resolvable `next` package, or `null` if not found.
 */
export function getNextVersion(): [number, number] | null {
  if (cachedVersion !== undefined) return cachedVersion
  try {
    const { version } = req('next/package.json')
    const [maj, min] = version.split('.').map((n: string) => parseInt(n, 10))
    cachedVersion = Number.isNaN(maj) || Number.isNaN(min) ? null : [maj, min]
  } catch {
    cachedVersion = null
  }
  return cachedVersion
}

/**
 * Verify that `@rspack/core` from `next-rspack` and from `@rsbuild/core` align.
 * Both are our direct dependencies so they should match at publish time; this
 * catches drift from user overrides or duplicate installations.
 */
function verifyRspackVersionAlignment(): void {
  try {
    const rsbuildVersion: string = req('@rspack/core/package.json').version
    const nextRspackEntry = req.resolve('next-rspack')
    const nextReq = createRequire(nextRspackEntry)
    const nextVersion: string = nextReq('@rspack/core/package.json').version

    if (rsbuildVersion !== nextVersion) {
      logger.warn(
        `@rspack/core version mismatch: Rsbuild uses ${rsbuildVersion}, ` +
          `but next-rspack uses ${nextVersion}. ` +
          'This may cause incompatible plugins/rules. ' +
          'Consider aligning @rsbuild/core and next-rspack versions.',
      )
    }
  } catch {
    // Best-effort — don't block startup
  }
}

const PREVIEW_KEYS = {
  previewModeId: 'storybook-preview',
  previewModeSigningKey: 'storybook-signing-key',
  previewModeEncryptionKey: 'storybook-encryption-key',
}

/**
 * Dummy values fed to `getBaseWebpackConfig()` to satisfy its required params.
 * Storybook never produces a real `.next/` build or serves draft-mode pages,
 * so these code paths are dead in our case — the values are inert, not secrets.
 * Keyed separately from version-dependent params (see `buildWebpackConfigParams`).
 * See AGENTS.md § Shim Catalogue.
 */
const DUMMY_NEXT_ARGS = {
  buildId: 'storybook-dev',
  encryptionKey: 'storybook-encryption-key-1234567890ab',
  rewrites: { beforeFiles: [], afterFiles: [], fallback: [] },
  originalRewrites: undefined,
  originalRedirects: undefined,
  entrypoints: {
    'main-app': { import: ['next/dist/client/next-dev.js'] },
  },
}

/**
 * Build the `getBaseWebpackConfig` options for the detected Next.js version.
 * Signature drift: 15.x uses `edgePreviewProps`; 16.0+ renamed to
 * `previewProps` (now required).
 */
function buildWebpackConfigParams(
  version: [number, number] | null,
  base: Record<string, any>,
): Record<string, any> {
  const params: Record<string, any> = { ...base }

  if (!version || version[0] >= 16) {
    params.previewProps = PREVIEW_KEYS
  } else if (version[0] === 15) {
    params.edgePreviewProps = PREVIEW_KEYS
  } else {
    logger.warn(
      `Next.js ${version.join('.')} is below the supported range (15.3+). ` +
        'Bridge may fail or produce incorrect config.',
    )
    params.edgePreviewProps = PREVIEW_KEYS
  }

  return params
}

const EMPTY_EXTRACTION: NextRspackExtraction = {
  alias: {},
  fallback: {},
  defines: {},
  resolveLoader: {},
  rawRules: [],
  rawPlugins: [],
}

/**
 * Call Next.js's `getBaseWebpackConfig()` in rspack mode and extract aliases,
 * defines, resolveLoader, raw rules, and raw plugins. On failure, logs the
 * error and returns an empty extraction so Storybook can still boot.
 *
 * `next-rspack` must be hoisted (via `hoistPattern`) so that `next`'s internal
 * `require('next-rspack/rspack-core')` can resolve it.
 */
export async function extractNextRspackConfig(
  dir?: string,
): Promise<NextRspackExtraction> {
  const projectDir = dir || process.cwd()
  const nextVersion = getNextVersion()

  try {
    return await doExtract(projectDir, nextVersion)
  } catch (err) {
    const versionLabel = nextVersion ? nextVersion.join('.') : 'unknown'
    logger.error(
      `Failed to bridge Next.js config (next@${versionLabel}). ` +
        'Storybook will boot with React support only — ' +
        'Next.js features (CSS, fonts, images, navigation mocks) will not work. ' +
        `Error: ${err instanceof Error ? err.message : String(err)}`,
    )
    return EMPTY_EXTRACTION
  }
}

async function doExtract(
  projectDir: string,
  nextVersion: [number, number] | null,
): Promise<NextRspackExtraction> {
  const [constantsMod, traceMod, configMod, webpackConfigMod, pagesDirMod] =
    await Promise.all([
      import('next/constants.js'),
      import('next/dist/trace/index.js'),
      import('next/dist/server/config.js'),
      import('next/dist/build/webpack-config.js'),
      import('next/dist/lib/find-pages-dir.js').catch(() => null),
    ])

  const { PHASE_DEVELOPMENT_SERVER, COMPILER_NAMES } = constantsMod
  const { Span } = traceMod
  // ESM import of CJS module can create double-wrapped default
  const loadConfig = configMod.default?.default || configMod.default
  const getBaseWebpackConfig =
    webpackConfigMod.default?.default || webpackConfigMod.default
  const { loadProjectInfo } = webpackConfigMod

  const nextConfig = await loadConfig(PHASE_DEVELOPMENT_SERVER, projectDir)
  const projectInfo = await loadProjectInfo({
    dir: projectDir,
    config: nextConfig,
    dev: true,
  })

  const dirs = pagesDirMod?.findPagesDir(projectDir)

  const params = buildWebpackConfigParams(nextVersion, {
    ...DUMMY_NEXT_ARGS,
    config: nextConfig,
    compilerType: COMPILER_NAMES.client,
    dev: true,
    pagesDir: dirs?.pagesDir,
    appDir: dirs?.appDir,
    runWebpackSpan: new Span({ name: 'storybook' }),
    jsConfig: projectInfo.jsConfig,
    jsConfigPath: projectInfo.jsConfigPath,
    resolvedBaseUrl: projectInfo.resolvedBaseUrl,
    supportedBrowsers: projectInfo.supportedBrowsers,
  })

  const rspackConfig = await getBaseWebpackConfig(projectDir, params)

  // rspack uses `_args[0]`, webpack uses `definitions`
  const defines: Record<string, any> = {}
  for (const plugin of rspackConfig.plugins || []) {
    const name = plugin?.constructor?.name
    if (name === 'DefinePlugin' || name === 'RspackDefinePlugin') {
      Object.assign(defines, plugin.definitions || plugin._args?.[0] || {})
    }
  }

  const alias = rspackConfig.resolve?.alias || {}
  const fallback = rspackConfig.resolve?.fallback || {}
  const rawRules = rspackConfig.module?.rules || []
  const rawPlugins = rspackConfig.plugins || []

  verifyRspackVersionAlignment()

  logger.info(
    `Extracted Next.js rspack config: ${Object.keys(alias).length} aliases, ` +
      `${Object.keys(defines).length} defines, ` +
      `${rawRules.length} rules, ${rawPlugins.length} plugins`,
  )

  return {
    alias,
    fallback,
    defines,
    resolveLoader: rspackConfig.resolveLoader || {},
    rawRules,
    rawPlugins,
  }
}

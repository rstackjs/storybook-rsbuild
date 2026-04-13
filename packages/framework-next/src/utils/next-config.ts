import { createRequire } from 'node:module'
import type { NextConfig } from 'next'
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
  /** DefinePlugin definitions (process.env.__NEXT_*, etc.) */
  defines: Record<string, any>
  /** resolveLoader configuration */
  resolveLoader: Record<string, any>
  /** The loaded NextConfig */
  nextConfig: NextConfig
  /** Absolute path to the user's project root */
  projectDir: string
  /** Raw module rules from getBaseWebpackConfig (client, dev). */
  rawRules: any[]
  /** Raw plugin instances from getBaseWebpackConfig (client, dev). */
  rawPlugins: any[]
}

// ---------------------------------------------------------------------------
// Rspack version alignment check
// ---------------------------------------------------------------------------

/**
 * Verify that `@rspack/core` from `next-rspack` and from `@rsbuild/core`
 * are the same version. Both are our direct dependencies so they should be
 * aligned at publish time; this catches drift from user overrides or
 * duplicate installations.
 */
function verifyRspackVersionAlignment(): void {
  try {
    const req = createRequire(import.meta.url)
    const rsbuildVersion: string = req('@rspack/core/package.json').version

    // Resolve from next-rspack's own context to find its @rspack/core copy
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
    // Version check is best-effort — don't block startup
  }
}

// ---------------------------------------------------------------------------
// Config extraction
// ---------------------------------------------------------------------------

/**
 * Call Next.js's `getBaseWebpackConfig()` in rspack mode and extract
 * aliases, defines, resolveLoader, raw rules, and raw plugins.
 *
 * This is the core bridge — Storybook reuses Next.js's native module
 * resolution and environment setup instead of manually re-implementing it.
 *
 * `next-rspack` is a direct dependency of this package and must be hoisted
 * (via `hoistPattern` in pnpm-workspace.yaml or the user's pnpm config)
 * so that `next`'s internal `require('next-rspack/rspack-core')` can
 * resolve it.
 */
export async function extractNextRspackConfig(
  dir?: string,
): Promise<NextRspackExtraction> {
  const projectDir = dir || process.cwd()

  const [constantsMod, traceMod, configMod, webpackConfigMod] =
    await Promise.all([
      import('next/constants.js'),
      import('next/dist/trace/index.js'),
      import('next/dist/server/config.js'),
      import('next/dist/build/webpack-config.js'),
    ])

  const { PHASE_DEVELOPMENT_SERVER, COMPILER_NAMES } = constantsMod
  const { Span } = traceMod
  // ESM import of CJS module can create double-wrapped default
  const loadConfig = configMod.default?.default || configMod.default
  const getBaseWebpackConfig =
    webpackConfigMod.default?.default || webpackConfigMod.default
  const loadProjectInfo =
    webpackConfigMod.loadProjectInfo ||
    webpackConfigMod.default?.loadProjectInfo

  const nextConfig = await loadConfig(PHASE_DEVELOPMENT_SERVER, projectDir)
  const projectInfo = await loadProjectInfo({
    dir: projectDir,
    config: nextConfig,
    dev: true,
  })

  let pagesDir: string | undefined
  let appDir: string | undefined
  try {
    const { findPagesDir } = await import('next/dist/lib/find-pages-dir.js')
    const dirs = findPagesDir(projectDir)
    pagesDir = dirs.pagesDir
    appDir = dirs.appDir
  } catch {
    // No pages/app dir — fine for Storybook
  }

  const rspackConfig = await getBaseWebpackConfig(projectDir, {
    buildId: 'storybook-dev',
    encryptionKey: 'storybook-encryption-key-1234567890ab',
    config: nextConfig,
    compilerType: COMPILER_NAMES.client,
    dev: true,
    entrypoints: {
      'main-app': { import: ['next/dist/client/next-dev.js'] },
    },
    pagesDir,
    appDir,
    rewrites: { beforeFiles: [], afterFiles: [], fallback: [] },
    originalRewrites: undefined,
    originalRedirects: undefined,
    runWebpackSpan: new Span({ name: 'storybook' }),
    jsConfig: projectInfo.jsConfig,
    jsConfigPath: projectInfo.jsConfigPath,
    resolvedBaseUrl: projectInfo.resolvedBaseUrl,
    supportedBrowsers: projectInfo.supportedBrowsers,
    previewProps: {
      previewModeId: 'storybook-preview',
      previewModeSigningKey: 'storybook-signing-key',
      previewModeEncryptionKey: 'storybook-encryption-key',
    },
  })

  // Extract DefinePlugin definitions — rspack uses `_args[0]`, webpack uses `definitions`
  const defines: Record<string, any> = {}
  for (const plugin of rspackConfig.plugins || []) {
    const name = plugin?.constructor?.name
    if (name === 'DefinePlugin' || name === 'RspackDefinePlugin') {
      Object.assign(defines, plugin.definitions || plugin._args?.[0] || {})
    }
  }

  const alias = rspackConfig.resolve?.alias || {}
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
    defines,
    resolveLoader: rspackConfig.resolveLoader || {},
    nextConfig,
    projectDir,
    rawRules,
    rawPlugins,
  }
}

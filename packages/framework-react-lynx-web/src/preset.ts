import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mergeRsbuildConfig } from '@rsbuild/core'
import type { PresetProperty } from 'storybook/internal/types'
import type { FrameworkOptions, StorybookConfig } from './types'

export const previewAnnotations: PresetProperty<'previewAnnotations'> = async (
  input = [],
) => {
  return [...input, fileURLToPath(import.meta.resolve('./preview'))]
}

export const core: PresetProperty<'core'> = async (config, options) => {
  const framework = await options.presets.apply('framework')

  return {
    ...config,
    builder: {
      name: fileURLToPath(import.meta.resolve('storybook-builder-rsbuild')),
      options:
        typeof framework === 'string' ? {} : framework.options.builder || {},
    },
    renderer: fileURLToPath(
      import.meta.resolve('@storybook/web-components/preset'),
    ),
  }
}

function resolveProjectRoot(configDir: string): string {
  return resolve(configDir, '..')
}

function findLynxConfig(
  projectRoot: string,
  configPath?: string,
): string | undefined {
  if (configPath) {
    const abs = resolve(projectRoot, configPath)
    return existsSync(abs) ? abs : undefined
  }

  for (const name of ['lynx.config.ts', 'lynx.config.js', 'lynx.config.mjs']) {
    const abs = join(projectRoot, name)
    if (existsSync(abs)) return abs
  }
  return undefined
}

export const rsbuildFinal: StorybookConfig['rsbuildFinal'] = async (
  config,
  options,
) => {
  const framework = await options.presets.apply('framework')
  const frameworkOptions: FrameworkOptions =
    typeof framework === 'string' ? {} : framework.options || {}

  const projectRoot = resolveProjectRoot(options.configDir)
  const bundlePrefix = frameworkOptions.lynxBundlePrefix ?? '/lynx-bundles'
  const lynxConfig = findLynxConfig(
    projectRoot,
    frameworkOptions.lynxConfigPath,
  )

  const isDev = options.configType !== 'PRODUCTION'
  const distDir = join(projectRoot, 'dist')

  const baseConfig = mergeRsbuildConfig(config, {
    source: {
      include: [/[\\/]node_modules[\\/]@lynx-js[\\/]/],
    },
  })

  // Dev + lynx config: proxy to rspeedy dev server with HMR support
  if (lynxConfig && isDev) {
    const sseClients: import('node:http').ServerResponse[] = []
    const rspeedyDevOrigin = await startRspeedyDev(
      projectRoot,
      sseClients,
      lynxConfig,
    )

    return mergeRsbuildConfig(baseConfig, {
      dev: {
        setupMiddlewares: [
          (middlewares) => {
            middlewares.unshift((req, res, next) => {
              // SSE endpoint: preview.ts subscribes to rebuild events
              if (req.url === '/__lynx_hmr__') {
                res.writeHead(200, {
                  'Content-Type': 'text/event-stream',
                  'Cache-Control': 'no-cache',
                  Connection: 'keep-alive',
                  'Access-Control-Allow-Origin': '*',
                })
                res.write('data: connected\n\n')
                sseClients.push(res)
                req.on('close', () => {
                  const idx = sseClients.indexOf(res)
                  if (idx !== -1) sseClients.splice(idx, 1)
                })
                return
              }
              // Proxy bundle requests (injects HMR polyfill)
              if (req.url?.startsWith(bundlePrefix)) {
                return proxyToRspeedy(
                  rspeedyDevOrigin,
                  req.url.slice(bundlePrefix.length),
                  res,
                )
              }
              // Proxy HMR hot-update requests (CSS/JS) to rspeedy
              if (req.url?.startsWith('/.rspeedy/')) {
                return pipeToRspeedy(rspeedyDevOrigin, req.url, res)
              }
              next()
            })
          },
        ],
      },
    })
  }

  // Build + lynx config: run rspeedy build, copy bundles into Storybook output
  if (lynxConfig && !isDev) {
    await runRspeedyBuild(projectRoot, lynxConfig)

    return mergeRsbuildConfig(baseConfig, {
      output: {
        copy: [
          {
            from: '**/*.web.bundle',
            context: distDir,
            to: `${bundlePrefix.slice(1)}/`,
          },
          {
            from: 'static/**/*',
            context: distDir,
            to: `${bundlePrefix.slice(1)}/`,
          },
        ],
      },
    })
  }

  // Dev without lynx config: serve pre-built bundles from dist/ as static files
  if (!lynxConfig && isDev) {
    return mergeRsbuildConfig(baseConfig, {
      dev: {
        setupMiddlewares: [
          (middlewares: any) => {
            middlewares.unshift(
              (
                req: any,
                res: import('node:http').ServerResponse,
                next: () => void,
              ) => {
                if (!req.url?.startsWith(bundlePrefix)) {
                  return next()
                }

                const fs = require('node:fs') as typeof import('node:fs')
                const path = require('node:path') as typeof import('node:path')
                const bundlePath = req.url
                  .slice(bundlePrefix.length)
                  .replace(/^\//, '')
                const filePath = path.resolve(distDir, bundlePath)

                // Prevent directory traversal outside distDir
                if (!filePath.startsWith(distDir + path.sep)) {
                  res.statusCode = 403
                  res.end('Forbidden')
                  return
                }

                if (!fs.existsSync(filePath)) {
                  res.statusCode = 404
                  res.end(
                    `Lynx bundle not found: ${bundlePath}\nEnsure your lynx.config entry names match story parameters.lynx.url paths.`,
                  )
                  return
                }

                const content = fs.readFileSync(filePath)
                res.setHeader('Content-Type', 'application/json')
                res.setHeader('Access-Control-Allow-Origin', '*')
                res.end(content)
              },
            )
          },
        ],
      },
    })
  }

  // Build without lynx config: nothing to configure
  return baseConfig
}

/**
 * Run rspeedy build (blocking) to produce static bundles for Storybook build.
 */
function runRspeedyBuild(projectRoot: string, configPath?: string): void {
  const { execFileSync } =
    require('node:child_process') as typeof import('node:child_process')

  const args = ['rspeedy', 'build', '--environment', 'web']
  if (configPath) args.push('--config', configPath)

  console.log('[lynx] Building Lynx components...')
  try {
    execFileSync('npx', args, {
      cwd: projectRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, FORCE_COLOR: '1' },
      shell: process.platform === 'win32',
    })
    console.log('[lynx] Build complete.')
  } catch (err: any) {
    const msg = err.stderr?.toString() || err.message
    console.error('[lynx] Build failed:', msg)
    throw new Error(`rspeedy build failed: ${msg}`)
  }
}

/**
 * Simple reverse proxy — pipes the rspeedy response directly to the client.
 * Used for HMR hot-update files (CSS/JS) that don't need polyfill injection.
 */
function pipeToRspeedy(
  origin: string,
  path: string,
  res: import('node:http').ServerResponse,
) {
  const http = require('node:http') as typeof import('node:http')
  http
    .get(`${origin}${path}`, (proxyRes) => {
      res.statusCode = proxyRes.statusCode ?? 200
      const ct = proxyRes.headers['content-type']
      if (ct) res.setHeader('Content-Type', ct)
      res.setHeader('Access-Control-Allow-Origin', '*')
      proxyRes.pipe(res)
    })
    .on('error', (err) => {
      console.error('[lynx] Proxy to rspeedy dev failed:', err.message)
      res.statusCode = 502
      res.end(`Failed to proxy to rspeedy dev server: ${err.message}`)
    })
}

/**
 * Polyfill for `lynx.requireModuleAsync` in web environment.
 * The Rspack HMR runtime (from @lynx-js/chunk-loading-webpack-plugin) uses
 * `lynx.requireModuleAsync(url, callback)` to fetch hot-update manifests
 * and chunks. This API exists in Lynx native but not in the web runtime.
 * We polyfill it with `fetch()` so HMR works inside <lynx-view>'s
 * iframe (main thread) and Web Worker (background thread).
 *
 * The rspeedy origin is injected so relative URLs (e.g. `.rspeedy/Button/...`)
 * resolve correctly even inside blob-URL Workers where `location` is unusable.
 */
function makeRequireModuleAsyncPolyfill(rspeedyOrigin: string): string {
  return `
if (typeof lynx !== 'undefined') {
  // Expose lynx on the global object so hot-update modules evaluated via
  // new Function() (which runs in the global scope, outside the bundle's
  // closure) can access it. Without this, ReferenceError: lynx is not defined.
  if (typeof self !== 'undefined' && !self.lynx) self.lynx = lynx;
  if (typeof globalThis !== 'undefined' && !globalThis.lynx) globalThis.lynx = lynx;

  var __rspeedyOrigin = ${JSON.stringify(rspeedyOrigin)};
  lynx.requireModuleAsync = function(url, callback) {
    if (url.indexOf('://') === -1) { url = __rspeedyOrigin + '/' + url; }
    var fetchFn = typeof fetch === 'function' ? fetch : globalThis.fetch;
    fetchFn(url).then(function(response) {
      if (!response.ok) {
        callback(new Error('HTTP ' + response.status + ' for ' + url));
        return;
      }
      var ct = response.headers.get('content-type') || '';
      if (ct.indexOf('json') !== -1) {
        response.json().then(
          function(data) { callback(null, data); },
          function(err) { callback(err); }
        );
      } else {
        response.text().then(function(text) {
          var module = { exports: {} };
          try {
            var fn = new Function('module', 'exports', text);
            fn(module, module.exports);
            callback(null, module.exports);
          } catch(e) { callback(e); }
        }, function(err) { callback(err); });
      }
    })['catch'](function(err) { callback(err); });
  };
}
`
}

/**
 * Proxy a bundle request to the rspeedy dev server.
 * Injects `lynx.requireModuleAsync` polyfill into the bundle JS sections
 * so that Rspack's HMR runtime can fetch hot-update files via `fetch()`.
 */
function proxyToRspeedy(
  origin: string,
  bundlePath: string,
  res: import('node:http').ServerResponse,
) {
  const http = require('node:http') as typeof import('node:http')
  const polyfill = makeRequireModuleAsyncPolyfill(origin)
  const url = `${origin}${bundlePath}`

  http
    .get(url, (proxyRes) => {
      if ((proxyRes.statusCode ?? 200) !== 200) {
        res.statusCode = proxyRes.statusCode ?? 502
        res.setHeader('Access-Control-Allow-Origin', '*')
        proxyRes.pipe(res)
        return
      }

      // Collect the full response to inject the polyfill
      const chunks: Buffer[] = []
      proxyRes.on('data', (chunk: Buffer) => chunks.push(chunk))
      proxyRes.on('end', () => {
        try {
          const body = Buffer.concat(chunks).toString('utf-8')
          const bundle = JSON.parse(body)

          // Inject polyfill into lepusCode (main thread JS)
          if (
            bundle.lepusCode?.root &&
            typeof bundle.lepusCode.root === 'string'
          ) {
            bundle.lepusCode.root = polyfill + bundle.lepusCode.root
          }

          // Inject polyfill into manifest (background thread JS)
          if (bundle.manifest && typeof bundle.manifest === 'object') {
            for (const key of Object.keys(bundle.manifest)) {
              if (typeof bundle.manifest[key] === 'string') {
                bundle.manifest[key] = polyfill + bundle.manifest[key]
              }
            }
          }

          const modified = JSON.stringify(bundle)
          res.statusCode = 200
          res.setHeader('Content-Type', 'application/json')
          res.setHeader('Access-Control-Allow-Origin', '*')
          res.end(modified)
        } catch {
          // If JSON parsing fails, just forward the original response
          const original = Buffer.concat(chunks)
          res.statusCode = 200
          res.setHeader('Content-Type', 'application/json')
          res.setHeader('Access-Control-Allow-Origin', '*')
          res.end(original)
        }
      })
    })
    .on('error', (err) => {
      console.error('[lynx] Proxy to rspeedy dev failed:', err.message)
      res.statusCode = 502
      res.end(`Failed to proxy to rspeedy dev server: ${err.message}`)
    })
}

/**
 * Start rspeedy dev server and return its origin URL (e.g. "http://192.168.1.1:3000").
 * Blocks until the first build is complete so Storybook can render immediately.
 * After the initial build, monitors stdout for subsequent rebuilds and notifies
 * all connected SSE clients so the browser can reload <lynx-view>.
 */
function startRspeedyDev(
  projectRoot: string,
  sseClients?: import('node:http').ServerResponse[],
  configPath?: string,
): Promise<string> {
  const { spawn } =
    require('node:child_process') as typeof import('node:child_process')

  return new Promise((resolve, reject) => {
    const args = ['rspeedy', 'dev', '--environment', 'web']
    if (configPath) args.push('--config', configPath)

    const child = spawn('npx', args, {
      cwd: projectRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, FORCE_COLOR: '1' },
      shell: process.platform === 'win32',
    })

    let settled = false
    // Track whether the current rebuild involves a CSS file.
    // JS changes are handled by Lynx's internal HMR (WebSocket from within
    // lynx-view connects to rspeedy directly). CSS changes can't be applied
    // inside the shadow DOM by the HMR runtime, so only CSS rebuilds trigger
    // a full <lynx-view> reload via SSE.
    let pendingCssRebuild = false

    const cleanup = () => {
      child.kill()
    }
    process.on('exit', cleanup)
    process.on('SIGINT', cleanup)
    process.on('SIGTERM', cleanup)

    const removeListeners = () => {
      process.removeListener('exit', cleanup)
      process.removeListener('SIGINT', cleanup)
      process.removeListener('SIGTERM', cleanup)
    }

    // Timeout after 30s
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true
        child.kill()
        removeListeners()
        reject(new Error('rspeedy dev server did not start within 30s'))
      }
    }, 30000)
    timer.unref()

    const onData = (data: Buffer) => {
      const msg = data.toString().trim()
      if (msg) console.log(`[lynx] ${msg}`)

      if (!settled) {
        // rspeedy prints URLs like "http://192.168.1.1:3000/Button.web.bundle"
        // Extract the origin from the first http URL we see
        const match = msg.match(/https?:\/\/[^\s/]+:\d+/)
        if (match) {
          settled = true
          clearTimeout(timer)
          const origin = match[0]
          console.log(`[lynx] rspeedy dev server ready at ${origin}`)
          resolve(origin)
        }
      } else if (sseClients) {
        // Rspeedy prints "building <file>" when a rebuild starts.
        if (/building\s.*\.css/.test(msg)) {
          pendingCssRebuild = true
        }

        // Rspeedy prints "ready  built in X.XXs" (with ANSI codes) on rebuild.
        // Only CSS rebuilds trigger SSE (full <lynx-view> reload) because
        // Lynx's CSS HMR can't apply styleInfo updates inside the shadow DOM.
        // JS changes are handled by Lynx's internal HMR (state-preserving).
        if (/ready\s.*built in/.test(msg) || /\[32mready/.test(msg)) {
          if (pendingCssRebuild) {
            console.log('[lynx] CSS rebuild detected, notifying SSE clients')
            for (const client of sseClients) {
              client.write('data: content-changed\n\n')
            }
          }
          pendingCssRebuild = false
        }
      }
    }

    child.stdout?.on('data', onData)
    child.stderr?.on('data', (data: Buffer) => {
      const msg = data.toString().trim()
      if (msg) console.error(`[lynx] ${msg}`)
      // Also check stderr for URL (rspeedy may print there)
      if (!settled) {
        const match = msg.match(/https?:\/\/[^\s/]+:\d+/)
        if (match) {
          settled = true
          clearTimeout(timer)
          resolve(match[0])
        }
      }
    })

    child.on('error', (err) => {
      if (!settled) {
        settled = true
        clearTimeout(timer)
        removeListeners()
        reject(new Error(`Failed to start rspeedy dev server: ${err.message}`))
      }
    })

    child.on('exit', (code) => {
      if (!settled) {
        settled = true
        clearTimeout(timer)
        removeListeners()
        reject(new Error(`rspeedy dev exited with code ${code}`))
      }
    })
  })
}

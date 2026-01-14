import { type SpawnOptionsWithoutStdio, spawn } from 'node:child_process'
import { once } from 'node:events'
import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { URL } from 'node:url'
import type { SandboxDefinition } from '../sandboxes'

const SERVER_READY_TIMEOUT_MS = 120_000
const SERVER_POLL_INTERVAL_MS = 500
const SERVER_SHUTDOWN_TIMEOUT_MS = 10_000

interface SandboxServerHandle {
  url: string
  stop: () => Promise<void>
}

export async function launchSandbox(
  definition: SandboxDefinition,
): Promise<SandboxServerHandle> {
  const resolvedDir = path.resolve(definition.relativeDir)
  const port = definition.port.toString()
  const pnpmArgs = ['exec', 'storybook', 'dev', '-p', port]
  const spawnOptions: SpawnOptionsWithoutStdio = {
    cwd: resolvedDir,
    env: {
      ...process.env,
      CI: 'true',
      PORT: port,
      ...definition.env,
    },
    stdio: ['pipe'],
    shell: process.platform === 'win32',
  }

  const child = spawn('pnpm', pnpmArgs, spawnOptions)

  const prefix = `[${definition.name}]`
  child.stdout?.setEncoding('utf-8')
  child.stdout?.on('data', (chunk) => {
    process.stdout.write(`${prefix} ${chunk}`)
  })
  child.stderr?.setEncoding('utf-8')
  child.stderr?.on('data', (chunk) => {
    process.stderr.write(`${prefix} ${chunk}`)
  })

  let exitCode: number | null = null
  let spawnError: Error | null = null
  child.on('exit', (code) => {
    exitCode = code
  })
  child.on('error', (error) => {
    spawnError = error as Error
  })

  const serverUrl = new URL(`http://127.0.0.1:${port}/`)
  await waitForServer(
    serverUrl,
    () => exitCode,
    () => spawnError,
  )

  return {
    url: serverUrl.toString(),
    stop: async () => {
      if (child.exitCode !== null) {
        return
      }
      const exitPromise = once(child, 'exit')
      child.kill('SIGTERM')
      const result = await Promise.race([
        exitPromise.then(() => 'exit'),
        delay(SERVER_SHUTDOWN_TIMEOUT_MS).then(() => 'timeout'),
      ])
      if (result === 'timeout') {
        child.kill('SIGKILL')
        await once(child, 'exit')
      }
    },
  }
}

async function waitForServer(
  serverUrl: URL,
  getExitCode: () => number | null,
  getSpawnError: () => Error | null,
): Promise<void> {
  const deadline = Date.now() + SERVER_READY_TIMEOUT_MS

  while (Date.now() <= deadline) {
    const exitCode = getExitCode()
    if (exitCode !== null) {
      throw new Error(
        `Storybook server exited early (URL: ${serverUrl.toString()}, exit code: ${exitCode})`,
      )
    }

    const spawnError = getSpawnError()
    if (spawnError) {
      throw spawnError
    }

    const reachable = await ping(serverUrl)
    if (reachable) {
      return
    }

    await delay(SERVER_POLL_INTERVAL_MS)
  }

  throw new Error(
    `Timed out waiting for Storybook to start (URL: ${serverUrl.toString()})`,
  )
}

async function ping(url: URL): Promise<boolean> {
  const requestFn = url.protocol === 'https:' ? httpsRequest : httpRequest

  return new Promise((resolve) => {
    const req = requestFn(
      {
        method: 'GET',
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        timeout: 2_000,
      },
      (res) => {
        res.resume()
        const status = res.statusCode ?? 500
        resolve(status >= 200 && status < 500)
      },
    )

    req.on('error', () => resolve(false))
    req.on('timeout', () => {
      req.destroy()
      resolve(false)
    })
    req.end()
  })
}

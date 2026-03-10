import { type SpawnOptionsWithoutStdio, spawn } from 'node:child_process'
import { once } from 'node:events'
import { setTimeout as delay } from 'node:timers/promises'
import { killProcessTree } from './process'

const DEFAULT_READY_TIMEOUT_MS = 120_000
const DEFAULT_SHUTDOWN_TIMEOUT_MS = 10_000

export interface DevServerHandle {
  stop: () => Promise<void>
}

export interface DevServerOptions {
  cwd: string
  command: {
    executable: string
    args: readonly string[]
  }
  readyIndicator: string
  readyTimeoutMs?: number
  shutdownTimeoutMs?: number
  logPrefix?: string
  env?: Record<string, string | undefined>
}

export async function launchDevServer(
  options: DevServerOptions,
): Promise<DevServerHandle> {
  const {
    cwd,
    command,
    readyIndicator,
    readyTimeoutMs = DEFAULT_READY_TIMEOUT_MS,
    shutdownTimeoutMs = DEFAULT_SHUTDOWN_TIMEOUT_MS,
    logPrefix,
    env,
  } = options

  const spawnOptions: SpawnOptionsWithoutStdio = {
    cwd,
    env: {
      ...process.env,
      CI: 'true',
      ...env,
    },
    stdio: ['pipe'],
    shell: process.platform === 'win32',
  }

  const child = spawn(command.executable, [...command.args], spawnOptions)

  const prefix = logPrefix ? `${logPrefix} ` : ''
  const readyNeedle = readyIndicator.toLowerCase()
  let resolveReady: (() => void) | null = null
  let readySignalled = false
  let stdoutBuffer = ''
  let stopping = false

  child.stdout?.setEncoding('utf-8')
  child.stderr?.setEncoding('utf-8')

  const readyPromise = new Promise<void>((resolve, reject) => {
    let settled = false
    let timeoutId: ReturnType<typeof setTimeout> | null = null

    const finish = (callback: () => void) => {
      if (settled) {
        return
      }
      settled = true
      if (timeoutId) {
        clearTimeout(timeoutId)
      }
      child.off('exit', onExit)
      child.off('error', onError)
      callback()
    }

    function onExit(code: number | null, signal: NodeJS.Signals | null) {
      finish(() => {
        const details = [
          code !== null ? `exit code ${code}` : null,
          signal ? `signal ${signal}` : null,
        ]
          .filter(Boolean)
          .join(', ')
        const suffix = details ? ` (${details})` : ''
        reject(new Error(`Dev server exited before it was ready${suffix}`))
      })
    }

    function onError(error: Error) {
      finish(() => reject(error))
    }

    timeoutId = setTimeout(() => {
      finish(() =>
        reject(
          new Error(
            `Timed out waiting for dev server to print "${readyIndicator}"`,
          ),
        ),
      )
    }, readyTimeoutMs)

    child.on('exit', onExit)
    child.on('error', onError)

    resolveReady = () => finish(resolve)
  })

  child.stdout?.on('data', (chunk) => {
    if (stopping) {
      return
    }
    if (prefix) {
      process.stdout.write(`${prefix}${chunk}`)
    } else {
      process.stdout.write(chunk)
    }
    if (readySignalled) {
      return
    }
    stdoutBuffer += chunk.toLowerCase()
    if (stdoutBuffer.includes(readyNeedle)) {
      readySignalled = true
      resolveReady?.()
      resolveReady = null
    } else if (stdoutBuffer.length > 10_000) {
      stdoutBuffer = stdoutBuffer.slice(-5_000)
    }
  })

  child.stderr?.on('data', (chunk) => {
    if (stopping) {
      return
    }
    if (prefix) {
      process.stderr.write(`${prefix}${chunk}`)
    } else {
      process.stderr.write(chunk)
    }
  })

  try {
    await readyPromise
  } catch (error) {
    stopping = true
    await stopChild(child, shutdownTimeoutMs)
    throw error
  }

  return {
    stop: async () => {
      stopping = true
      await stopChild(child, shutdownTimeoutMs)
    },
  }
}

async function stopChild(
  child: ReturnType<typeof spawn>,
  shutdownTimeoutMs: number,
): Promise<void> {
  if (child.exitCode !== null) {
    return
  }

  const exitPromise = once(child, 'exit')
  await killProcessTree(child.pid, 'SIGTERM')
  const result = await Promise.race([
    exitPromise.then(() => 'exit' as const),
    delay(shutdownTimeoutMs).then(() => 'timeout' as const),
  ])

  if (result === 'timeout') {
    await killProcessTree(child.pid, 'SIGKILL')
    await once(child, 'exit')
  }
}

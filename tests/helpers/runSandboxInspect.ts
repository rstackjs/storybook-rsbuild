import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { fileURLToPath } from 'node:url'
import { stripVTControlCharacters as stripAnsi } from 'node:util'

export interface SandboxInspectResult {
  sandboxName: string
  outputDir: string
  logs: string
}

const repoRoot = fileURLToPath(new URL('../..', import.meta.url))
const inspectCache = new Map<string, Promise<SandboxInspectResult>>()

export function runSandboxInspect(
  sandboxName: string,
): Promise<SandboxInspectResult> {
  if (!inspectCache.has(sandboxName)) {
    inspectCache.set(sandboxName, inspectSandboxOnce(sandboxName))
  }

  return inspectCache.get(sandboxName)!
}

async function inspectSandboxOnce(
  sandboxName: string,
): Promise<SandboxInspectResult> {
  const filter = `@sandboxes/${sandboxName}`
  const child = spawn('pnpm', ['--filter', filter, 'run', 'build:storybook'], {
    cwd: repoRoot,
    env: {
      ...process.env,
      CI: 'true',
      FORCE_COLOR: '0',
    },
    shell: process.platform === 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  let stdout = ''
  let stderr = ''

  child.stdout?.setEncoding('utf8')
  child.stdout?.on('data', (chunk: string) => {
    stdout += chunk
  })

  child.stderr?.setEncoding('utf8')
  child.stderr?.on('data', (chunk: string) => {
    stderr += chunk
  })

  const [code] = (await once(child, 'close')) as [number | null, NodeJS.Signals]

  const logs = `${stdout}${stderr}`
  const sanitizedLogs = stripAnsi(logs)

  if (code !== 0) {
    throw new Error(
      `storybook build failed for sandbox "${sandboxName}" (exit ${code}).\n${logs}`,
    )
  }

  const parsed = parseInspectOutput(sanitizedLogs)
  if (!parsed.outputDir) {
    throw new Error(
      `Failed to detect output directory for sandbox "${sandboxName}". Logs:\n${logs}`,
    )
  }

  return {
    sandboxName,
    outputDir: parsed.outputDir,
    logs,
  }
}

function parseInspectOutput(output: string) {
  const outputDirMatch = /Output directory:\s*(.+)$/m.exec(output)
  const outputDir = outputDirMatch?.[1].trim().replace(/^│\s*/, '')

  return {
    outputDir,
  }
}

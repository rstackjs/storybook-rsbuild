#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import {
  appendFileSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

interface CommitRecord {
  sha: string
  date: string
  message: string
  files: string[]
}

interface CommitAnalysisRecord {
  sha: string
  date: string
  message: string
  frameworks: string[]
  files: string[]
  diff: string
}

const REMOTE_URL = 'https://github.com/storybookjs/storybook.git'
const WATCH_PATH = 'code/frameworks'
const CHECKPOINT_ENV = 'STORYBOOK_SYNC_CHECK_LAST_SHA'
const LOOKBACK_HOURS_ENV = 'STORYBOOK_SYNC_LOOKBACK_HOURS'
const DEFAULT_LOOKBACK_HOURS = 36
const SUMMARY_MENTION = '@fi3ework'
const HOUR_MS = 60 * 60 * 1000
const SHA_REGEX = /^[0-9a-f]{40}$/i
const FRAMEWORK_SRC_FILE_REGEX = /^code\/frameworks\/([^/]+)\/src\//
const DIFF_MAX_CHARS = 6000
const OPENCODE_MODEL = 'opencode/claude-haiku-4-5'
const OPENCODE_PROMPT_TEMPLATE = new URL(
  './storybook-frameworks-sync.prompt.md',
  import.meta.url,
)
const STEP_SUMMARY_PATH = process.env.GITHUB_STEP_SUMMARY
const GITHUB_OUTPUT_PATH = process.env.GITHUB_OUTPUT

const commandOutput = (
  command: string,
  args: string[],
  cwd?: string,
): string => {
  return execFileSync(command, args, {
    cwd,
    encoding: 'utf-8',
    env: process.env,
  })
}

const commandOutputFromFile = (
  command: string,
  args: string[],
  inputFilePath: string,
  cwd?: string,
): string => {
  const input = readFileSync(inputFilePath, 'utf-8')
  return execFileSync(command, args, {
    cwd,
    encoding: 'utf-8',
    env: process.env,
    input,
  })
}

const isValidSha = (value?: string): value is string =>
  typeof value === 'string' && SHA_REGEX.test(value)

const getFrameworkNameFromFile = (file: string): string | null => {
  const match = file.match(FRAMEWORK_SRC_FILE_REGEX)
  return match?.[1] ?? null
}

const EXCLUDE_FRAMEWORK_KEYWORDS = ['next', 'angular'] as const
const isExcludeFramework = (name: string): boolean =>
  EXCLUDE_FRAMEWORK_KEYWORDS.some((keyword) => name.includes(keyword))

const filterFilesByFrameworkRules = (files: string[]): string[] => {
  const srcFiles = files.filter((file) => FRAMEWORK_SRC_FILE_REGEX.test(file))
  return srcFiles.filter((file) => {
    const framework = getFrameworkNameFromFile(file)
    return framework ? !isExcludeFramework(framework) : false
  })
}

const formatIso = (date: Date) => date.toISOString().replace(/\.\d{3}Z$/, 'Z')

const readCheckpoint = (): string => process.env[CHECKPOINT_ENV]?.trim() ?? ''

const readLookbackHours = (): number => {
  const raw = process.env[LOOKBACK_HOURS_ENV]?.trim()
  if (!raw) {
    return DEFAULT_LOOKBACK_HOURS
  }

  const parsed = Number(raw)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    console.warn(
      `Invalid ${LOOKBACK_HOURS_ENV}=${raw}, fallback to ${DEFAULT_LOOKBACK_HOURS}.`,
    )
    return DEFAULT_LOOKBACK_HOURS
  }

  return parsed
}

const sinceDate = (lookbackHours: number): string =>
  formatIso(new Date(Date.now() - lookbackHours * HOUR_MS))

const getCandidateSpec = (
  workspace: string,
  checkpointSha: string,
  lookbackHours: number,
): {
  spec: string
  mode: 'lookback' | 'increment'
  reason: string
} => {
  const sinceArg = `--since=${sinceDate(lookbackHours)}`

  if (!isValidSha(checkpointSha)) {
    return {
      spec: sinceArg,
      mode: 'lookback',
      reason: `checkpoint=${checkpointSha} (not a valid full SHA)`,
    }
  }

  try {
    commandOutput(
      'git',
      ['cat-file', '-t', `${checkpointSha}^{commit}`],
      workspace,
    )
    return {
      spec: `${checkpointSha}..HEAD`,
      mode: 'increment',
      reason: `checkpoint=${checkpointSha}`,
    }
  } catch {
    return {
      spec: sinceArg,
      mode: 'lookback',
      reason: `checkpoint=${checkpointSha} (invalid in checked-out history)`,
    }
  }
}

const getRelevantCommits = (
  workspace: string,
  rangeOrSince: string,
): CommitRecord[] => {
  const args = [
    'log',
    rangeOrSince,
    '--name-only',
    '--pretty=format:COMMIT\t%H\t%aI\t%s',
    '--',
    WATCH_PATH,
  ]

  const raw = commandOutput('git', args, workspace)

  const records: CommitRecord[] = []

  let current: CommitRecord | null = null
  for (const line of raw.split('\n')) {
    if (line.startsWith('COMMIT\t')) {
      if (current) {
        records.push(current)
      }
      const [, sha, date, ...messageParts] = line.split('\t')
      current = {
        sha: sha ?? '',
        date: date ?? '',
        message: messageParts.join('\t'),
        files: [],
      }
      continue
    }

    if (!current) {
      continue
    }

    const file = line.trim()
    if (!file) {
      continue
    }

    current.files.push(file)
  }

  if (current) {
    records.push(current)
  }

  return records
    .map((record) => ({
      ...record,
      files: filterFilesByFrameworkRules(record.files),
    }))
    .filter((record) => record.files.length > 0)
}

const toFrameworkNames = (files: string[]) => {
  const names = new Set<string>()
  for (const file of files) {
    const match = file.match(/^code\/frameworks\/([^/]+)\//)?.[1]
    if (match) {
      names.add(match)
    }
  }
  return [...names]
}

const getCommitDiff = (workspace: string, record: CommitRecord): string => {
  const srcFiles = record.files.filter((file) =>
    FRAMEWORK_SRC_FILE_REGEX.test(file),
  )
  if (!srcFiles.length) {
    return ''
  }

  const rawDiff = commandOutput(
    'git',
    ['show', '--no-color', '--unified=0', record.sha, '--', ...srcFiles],
    workspace,
  )
  if (rawDiff.length <= DIFF_MAX_CHARS) {
    return rawDiff.trimEnd()
  }

  return `${rawDiff.slice(0, DIFF_MAX_CHARS)}\n... [truncated to ${DIFF_MAX_CHARS} chars]`
}

const prepareAnalysisPayload = (
  workspace: string,
  records: CommitRecord[],
): CommitAnalysisRecord[] => {
  return records.map((record) => ({
    sha: record.sha,
    date: record.date,
    message: record.message,
    frameworks: toFrameworkNames(record.files),
    files: record.files,
    diff: getCommitDiff(workspace, record),
  }))
}

const buildOpenCodePrompt = (records: CommitAnalysisRecord[]): string => {
  const template = readFileSync(OPENCODE_PROMPT_TEMPLATE, 'utf-8')
  return template.replace('{{COMMITS_JSON}}', JSON.stringify(records, null, 2))
}

const analyzeWithOpenCode = (
  workspace: string,
  records: CommitAnalysisRecord[],
): string => {
  if (!records.length) {
    return '[]'
  }

  const promptPath = join(workspace, 'opencode-prompt.md')
  writeFileSync(promptPath, buildOpenCodePrompt(records))
  const output = commandOutputFromFile(
    'opencode',
    ['run', '-m', OPENCODE_MODEL],
    promptPath,
    workspace,
  ).trim()
  if (STEP_SUMMARY_PATH) {
    appendFileSync(STEP_SUMMARY_PATH, '### OpenCode Analysis\n')
    appendFileSync(STEP_SUMMARY_PATH, `${output}\n`)
  }

  return output
}

const appendSummaryMention = (): void => {
  if (!STEP_SUMMARY_PATH) {
    return
  }

  appendFileSync(STEP_SUMMARY_PATH, '### Sync Owners\n')
  appendFileSync(STEP_SUMMARY_PATH, `${SUMMARY_MENTION}\n`)
}

const toOutput = (name: string, value: string): void => {
  if (!GITHUB_OUTPUT_PATH) {
    return
  }

  if (value.includes('\n')) {
    const token = `__${name}_${Date.now()}_${Math.random().toString(36).slice(2)}__`
    appendFileSync(
      GITHUB_OUTPUT_PATH,
      `${name}<<${token}\n${value}\n${token}\n`,
    )
    return
  }

  appendFileSync(GITHUB_OUTPUT_PATH, `${name}=${value}\n`)
}

const formatReport = (
  records: CommitRecord[],
  mode: 'lookback' | 'increment',
  reason: string,
  lookbackHours: number,
): string => {
  const header =
    mode === 'lookback'
      ? `Lookback mode: using ${lookbackHours}h history window (${reason}).`
      : `Increment mode: using ${reason} as lower bound.`

  const body = records
    .map((record) => {
      const frameworks = toFrameworkNames(record.files)

      return `- [\`${record.sha}\`](https://github.com/storybookjs/storybook/commit/${record.sha}) ${record.message}
  - Date: ${record.date}
  - Frameworks: ${frameworks.join(', ')}
  - Files:
${record.files.map((file) => `    - ${file}`).join('\n')}`
    })
    .join('\n\n')

  if (!records.length) {
    return `${header}\n\nNo commits matched code/frameworks/*/src changes.`
  }

  return `${header}\n\n### Matching commits\n\n${body}`
}

const workspace = mkdtempSync(join(tmpdir(), 'storybook-sync-'))
try {
  const lookbackHours = readLookbackHours()
  const checkpointSha = readCheckpoint()
  commandOutput('git', [
    'clone',
    '--filter=blob:none',
    '--single-branch',
    '--branch',
    'next',
    REMOTE_URL,
    workspace,
  ])

  const { spec, mode, reason } = getCandidateSpec(
    workspace,
    checkpointSha,
    lookbackHours,
  )
  const records = getRelevantCommits(workspace, spec)
  const headSha = commandOutput('git', ['rev-parse', 'HEAD'], workspace).trim()

  if (!records.length) {
    const report =
      mode === 'lookback'
        ? `No commits matched ${WATCH_PATH}/*/src changes in the last ${lookbackHours}h.`
        : `No commits matched ${WATCH_PATH}/*/src changes since ${reason}.`

    console.log(report)
    if (STEP_SUMMARY_PATH) {
      appendFileSync(STEP_SUMMARY_PATH, `${report}\n`)
    }

    toOutput('sync_report', report)
    toOutput('next_head_sha', headSha)
    toOutput('used_fallback', mode === 'lookback' ? 'true' : 'false')
    toOutput('has_target_commits', 'false')
    toOutput('sync_analysis_payload', '[]')
    toOutput('opencode_analysis', '[]')
    toOutput('has_opencode_analysis', 'false')
  } else {
    appendSummaryMention()
    const analysisPayload = prepareAnalysisPayload(workspace, records)
    const openCodeAnalysis = analyzeWithOpenCode(workspace, analysisPayload)
    const report = formatReport(records, mode, reason, lookbackHours)

    console.log(report)
    if (STEP_SUMMARY_PATH) {
      appendFileSync(STEP_SUMMARY_PATH, `${report}\n`)
    }

    toOutput('sync_report', report)
    toOutput('next_head_sha', headSha)
    toOutput('used_fallback', mode === 'lookback' ? 'true' : 'false')
    toOutput('has_target_commits', 'true')
    toOutput('sync_analysis_payload', JSON.stringify(analysisPayload))
    toOutput('opencode_analysis', openCodeAnalysis)
    toOutput(
      'has_opencode_analysis',
      openCodeAnalysis.trim().length > 0 ? 'true' : 'false',
    )
  }
} finally {
  rmSync(workspace, { recursive: true, force: true })
}

import { type Rspack, rspack } from '@rsbuild/core'
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  rs,
} from '@rstest/core'
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { basename, dirname, join, normalize } from 'node:path'
import { createAutomockRules } from '../../src/plugins/rsbuild-plugin-storybook-mock'
import { RspackMockPlugin } from '../../src/plugins/rspack-mock-plugin'

const loggerMock = rs.hoisted(() => ({
  debug: rs.fn(),
  info: rs.fn(),
  warn: rs.fn(),
}))

rs.mock('storybook/internal/node-logger', () => ({
  logger: loggerMock,
}))

const require = createRequire(import.meta.url)
const automockLoader =
  require.resolve('storybook-builder-rsbuild/loaders/rsbuild-automock-loader')

let root: string
let project: string
let linkedProject: string

const files: Record<string, string> = {
  'package.json': JSON.stringify({ name: 'fixture' }),
  '.storybook/preview.js': [
    "import { sb } from 'storybook/test';",
    "sb.mock('../src/api.js');",
    "sb.mock('../src/utils/format.ts');",
    "sb.mock('../src/components/Icon.tsx', { spy: true });",
    "sb.mock('../src/query-format.ts');",
    "sb.mock('../src/query-api.js');",
    "sb.mock('ext-pkg');",
    "sb.mock('server-pkg');",
  ].join('\n'),
  '.storybook/preview-without-mocks.js': 'export default {};',
  '.storybook/preview-dual-pkg.js': [
    "import { sb } from 'storybook/test';",
    "sb.mock('dual-pkg');",
  ].join('\n'),
  '.storybook/preview-cjs-only-pkg.js': [
    "import { sb } from 'storybook/test';",
    "sb.mock('cjs-only-pkg');",
  ].join('\n'),
  '.storybook/preview-with-unresolvable-mock.js': [
    "import { sb } from 'storybook/test';",
    "sb.mock('../src/api.js');",
    "sb.mock('../src/data');",
  ].join('\n'),
  'src/index.js': [
    "import { api } from './api.js';",
    "import { format } from '@/utils/format';",
    "import { Button } from './components/Button';",
    "import { ext } from 'ext-pkg';",
    "import { server } from 'server-pkg';",
    "import { queryApi } from './query-api.js?foo';",
    "import { queryFormat } from '@/query-format?foo#bar';",
    "import { other } from './other.js';",
    'export default [api, format, Button, ext, server, queryApi, queryFormat, other];',
  ].join('\n'),
  'src/index-dual.js': [
    "import { dual } from 'dual-pkg';",
    'export default dual;',
  ].join('\n'),
  'src/index-cjs-only.js': [
    "const { cjs } = require('cjs-only-pkg');",
    'export default cjs;',
  ].join('\n'),
  'src/index-without-server-pkg.js': [
    "import { api } from './api.js';",
    "import { ext } from 'ext-pkg';",
    'export default [api, ext];',
  ].join('\n'),
  'src/api.js': "export const api = 'REAL_API';",
  'src/data.json': '{}',
  'src/__mocks__/api.js':
    "import { helper } from './helper.js'; export const api = 'MOCKED_API_' + helper;",
  'src/__mocks__/helper.js': "export const helper = 'FROM_MOCKS_DIR';",
  'src/utils/format.ts':
    "export const format = (): string => 'REAL_FORMAT' + 'NEEDS_PROJECT_LOADER';",
  'src/components/Button.tsx':
    "import { Icon } from './Icon'; export const Button = () => 'BUTTON' + Icon();",
  'src/components/Icon.tsx': "export const Icon = (): string => 'REAL_ICON';",
  'src/query-api.js': "export const queryApi = 'REAL_QUERY_API';",
  'src/__mocks__/query-api.js': "export const queryApi = 'MOCKED_QUERY_API';",
  'src/query-format.ts':
    "export const queryFormat = (): string => 'REAL_QUERY_FORMAT';",
  'src/other.js': "export const other = 'OTHER';",
  'node_modules/ext-pkg/package.json': JSON.stringify({
    name: 'ext-pkg',
    main: 'index.js',
  }),
  'node_modules/ext-pkg/index.js': "export const ext = 'REAL_EXT';",
  '__mocks__/ext-pkg.js':
    "export const ext = 'MOCKED_EXT_' + 'NEEDS_PROJECT_LOADER';",
  // Only Node's resolver can reach this package; Rspack's browser conditions cannot.
  'node_modules/server-pkg/package.json': JSON.stringify({
    name: 'server-pkg',
    exports: { '.': { node: './index.js' } },
  }),
  'node_modules/server-pkg/index.js': "export const server = 'REAL_SERVER';",
  '__mocks__/server-pkg.js': "export const server = 'MOCKED_SERVER';",
  'node_modules/dual-pkg/package.json': JSON.stringify({
    name: 'dual-pkg',
    exports: {
      '.': { import: './esm.js', require: './cjs.js' },
    },
  }),
  'node_modules/dual-pkg/esm.js': "export const dual = 'REAL_DUAL_ESM';",
  'node_modules/dual-pkg/cjs.js': "export const dual = 'REAL_DUAL_CJS';",
  'node_modules/cjs-only-pkg/package.json': JSON.stringify({
    name: 'cjs-only-pkg',
    exports: { '.': { require: './index.js' } },
  }),
  'node_modules/cjs-only-pkg/index.js': "export const cjs = 'REAL_CJS_ONLY';",
  'project-loader.cjs':
    "module.exports = (source) => source.replace('NEEDS_PROJECT_LOADER', 'PROJECT_LOADER_RAN');",
}

function writeFixture() {
  root = normalize(
    realpathSync(mkdtempSync(join(tmpdir(), 'rspack-mock-plugin-'))),
  )
  project = join(root, 'project')
  linkedProject = join(root, 'linked')
  for (const [file, content] of Object.entries(files)) {
    mkdirSync(dirname(join(project, file)), { recursive: true })
    writeFileSync(join(project, file), content)
  }
  symlinkSync(project, linkedProject, 'junction')
}

function makeAutomockWrapper() {
  const logFile = join(project, 'automock.log')
  const wrapper = join(project, 'automock-wrapper.mjs')
  writeFileSync(
    wrapper,
    `import { appendFileSync } from 'node:fs'
import real from ${JSON.stringify(automockLoader)}

export default function (source) {
  appendFileSync(${JSON.stringify(logFile)}, JSON.stringify({
    resourcePath: this.resourcePath,
    resourceQuery: this.resourceQuery,
    options: this.getOptions(),
    sourceHasTypeAnnotation: String(source).includes(': string'),
  }) + '\\n')
  return real.call(this, source)
}
`,
  )
  return { wrapper, logFile }
}

beforeAll(() => {
  writeFixture()
})

beforeEach(() => {
  loggerMock.info.mockImplementation(() => {})
  loggerMock.warn.mockImplementation(() => {})
  loggerMock.debug.mockImplementation(() => {})
})

afterAll(() => {
  rmSync(root, { recursive: true, force: true })
})

interface CompileOptions {
  previewFile?: string
  context?: string
  config?: Partial<Rspack.Configuration>
}

async function compile({
  previewFile = '.storybook/preview.js',
  context = project,
  config = {},
}: CompileOptions = {}) {
  const { wrapper } = makeAutomockWrapper()
  const outputPath = join(
    root,
    'dist',
    `${basename(context)}-${previewFile.replace(/\W/g, '-')}`,
  )
  const stats = await new Promise<Rspack.Stats>((resolve, reject) =>
    rspack(
      {
        mode: 'development',
        devtool: false,
        context,
        entry: './src/index.js',
        output: { path: outputPath, filename: 'bundle.js' },
        module: {
          rules: [
            {
              test: /\.(ts|tsx)$/,
              exclude: /node_modules/,
              use: [
                {
                  loader: 'builtin:swc-loader',
                  options: {
                    jsc: { parser: { syntax: 'typescript', tsx: true } },
                    module: { type: 'es6' },
                  },
                },
              ],
            },
            {
              test: /\.(js|ts|tsx)$/,
              exclude: /node_modules/,
              loader: join(project, 'project-loader.cjs'),
            },
            ...createAutomockRules(wrapper),
          ],
        },
        plugins: [
          new RspackMockPlugin({
            previewConfigPath: join(context, previewFile),
          }),
        ],
        ...config,
        resolve: {
          extensions: ['.tsx', '.ts', '.js'],
          alias: { '@': join(context, 'src') },
          ...config.resolve,
        },
      },
      (error, result) => {
        if (error) {
          reject(error)
        } else if (result) {
          resolve(result)
        } else {
          reject(new Error('Rspack did not return compilation stats'))
        }
      },
    ),
  )
  expect(stats.toString({ all: false, errors: true })).toBe('')
  const modules = [...stats.compilation.modules].filter(
    (module): module is Rspack.NormalModule => 'resource' in module,
  )
  return {
    bundle: readFileSync(join(outputPath, 'bundle.js'), 'utf-8'),
    sourceOf: (file: string) => {
      const candidates = modules.filter(
        (candidate) =>
          normalize(candidate.resource.split('?')[0]) === join(context, file),
      )
      const module =
        candidates.find((candidate) => candidate.resource.includes('?')) ??
        candidates[0]
      expect(module, `module ${file}`).toBeDefined()
      return String(module?.originalSource()?.source())
    },
  }
}

describe('RspackMockPlugin', () => {
  let build: Awaited<ReturnType<typeof compile>>

  beforeAll(async () => {
    build = await compile()
  })

  it('replaces a relative mock with its __mocks__ file', () => {
    expect(build.bundle).toContain('MOCKED_API_')
    expect(build.bundle).not.toContain('REAL_API')
  })

  it("resolves the __mocks__ file's own imports from the __mocks__ directory", () => {
    expect(build.bundle).toContain('FROM_MOCKS_DIR')
  })

  it('automocks a module imported through an alias, after the project loaders', () => {
    const source = build.sourceOf('src/utils/format.ts')
    expect(source).toContain('__vitest_mocked_module__')
    expect(source).toContain('"automock"')
    expect(source).toContain('PROJECT_LOADER_RAN')
  })

  it('automocks a .tsx module imported without an extension and passes the spy option', () => {
    const source = build.sourceOf('src/components/Icon.tsx')
    expect(source).toContain('__vitest_mocked_module__')
    expect(source).toContain('"autospy"')
  })

  it('matches a manual mock when the import carries a query', () => {
    expect(build.bundle).toContain('MOCKED_QUERY_API')
    expect(build.bundle).not.toContain('REAL_QUERY_API')
  })

  it('automocks a query/fragment import by its path and keeps the query', () => {
    const source = build.sourceOf('src/query-format.ts')
    expect(source).toContain('__vitest_mocked_module__')
    expect(source).toContain('"automock"')
  })

  it('replaces a bare specifier with its __mocks__ file and runs the project loaders on it', () => {
    expect(build.bundle).toContain('PROJECT_LOADER_RAN')
    expect(build.bundle).not.toContain('REAL_EXT')
    expect(build.sourceOf('__mocks__/ext-pkg.js')).toContain('MOCKED_EXT_')
  })

  it('replaces a package that Rspack cannot resolve with its __mocks__ file', () => {
    expect(build.bundle).toContain('MOCKED_SERVER')
    expect(build.bundle).not.toContain('REAL_SERVER')
    expect(loggerMock.warn).not.toHaveBeenCalledWith(
      expect.stringContaining('server-pkg'),
    )
  })

  it('leaves unmocked modules alone', () => {
    expect(build.bundle).toContain('OTHER')
    expect(build.sourceOf('src/other.js')).not.toContain(
      '__vitest_mocked_module__',
    )
  })

  it('runs the automock loader after swc and passes spy through rule options', () => {
    const log = readFileSync(join(project, 'automock.log'), 'utf-8')
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line))

    const format = log.find((entry) => entry.resourcePath.endsWith('format.ts'))
    const icon = log.find((entry) => entry.resourcePath.endsWith('Icon.tsx'))

    expect(format).toMatchObject({
      options: { spy: 'false' },
      sourceHasTypeAnnotation: false,
    })
    expect(icon).toMatchObject({
      options: { spy: 'true' },
      sourceHasTypeAnnotation: false,
    })
  })

  it('mocks a dual package through its ESM entry', async () => {
    const { sourceOf } = await compile({
      previewFile: '.storybook/preview-dual-pkg.js',
      config: { entry: './src/index-dual.js' },
    })

    expect(sourceOf('node_modules/dual-pkg/esm.js')).toContain(
      '__vitest_mocked_module__',
    )
    expect(loggerMock.warn).not.toHaveBeenCalled()
  })

  it('falls back to the commonjs resolver for a require-only package', async () => {
    const result = await compile({
      previewFile: '.storybook/preview-cjs-only-pkg.js',
      config: { entry: './src/index-cjs-only.js' },
    })
    const { sourceOf } = result

    expect(sourceOf('node_modules/cjs-only-pkg/index.js')).toContain(
      '__vitest_mocked_module__',
    )
    expect(loggerMock.warn).not.toHaveBeenCalled()
  })

  it('applies relative mocks when Rspack keeps symlinked paths', async () => {
    const { bundle } = await compile({
      context: linkedProject,
      config: { resolve: { symlinks: false } },
    })

    expect(bundle).toContain('MOCKED_API_')
    expect(bundle).not.toContain('REAL_API')
  })

  // Node resolves `../src/data` to `data.json`; Rspack's configured extensions do not.
  it('warns about a mock that Rspack cannot resolve and keeps the others', async () => {
    const { bundle } = await compile({
      previewFile: '.storybook/preview-with-unresolvable-mock.js',
      config: { entry: './src/index-without-server-pkg.js' },
    })

    expect(bundle).toContain('MOCKED_API_')
    expect(loggerMock.warn).toHaveBeenCalledWith(
      expect.stringContaining('Could not resolve "../src/data"'),
    )
  })

  it('changes nothing when the preview file has no mocks', async () => {
    const { bundle } = await compile({
      previewFile: '.storybook/preview-without-mocks.js',
      config: { entry: './src/index-without-server-pkg.js' },
    })

    expect(bundle).toContain('REAL_API')
    expect(bundle).toContain('REAL_EXT')
    expect(bundle).not.toContain('__vitest_mocked_module__')
    expect(loggerMock.info).not.toHaveBeenCalled()
    expect(loggerMock.warn).not.toHaveBeenCalled()
  })
})

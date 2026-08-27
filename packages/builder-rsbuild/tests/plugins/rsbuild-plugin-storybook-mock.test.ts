import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { describe, expect, it } from '@rstest/core'

const execFileAsync = promisify(execFile)
const resultMarker = '__STORYBOOK_MOCK_CONFIG__'

describe('pluginStorybookMock', () => {
  it('applies mock wiring after a replacement tools.rspack callback', async () => {
    const packageDir = fileURLToPath(new URL('../..', import.meta.url))
    const { stdout } = await execFileAsync(
      process.execPath,
      [
        '--import',
        'tsx',
        '--input-type=module',
        '--eval',
        `
          import { createRsbuild } from '@rsbuild/core'
          import { pluginStorybookMock } from './src/plugins/rsbuild-plugin-storybook-mock.ts'

          const rsbuild = await createRsbuild({
            cwd: process.cwd(),
            rsbuildConfig: {
              plugins: [
                pluginStorybookMock({
                  previewConfigPath: '/project/.storybook/preview.ts',
                }),
              ],
              tools: {
                rspack: () => ({
                  module: { rules: [] },
                  plugins: [],
                }),
              },
            },
          })

          const [rspackConfig] = await rsbuild.initConfigs()
          const rules = (rspackConfig.module?.rules ?? []).map((rule) => ({
            test: rule && typeof rule === 'object' ? String(rule.test) : '',
            loaders:
              rule && typeof rule === 'object' && Array.isArray(rule.use)
                ? rule.use
                    .map((item) =>
                      typeof item === 'string' ? item : item?.loader,
                    )
                    .filter(Boolean)
                : [],
          }))
          const plugins = (rspackConfig.plugins ?? []).map(
            (plugin) => plugin.constructor.name,
          )

          process.stdout.write(
            '${resultMarker}' + JSON.stringify({ rules, plugins }),
          )
        `,
      ],
      { cwd: packageDir, encoding: 'utf8' },
    )
    const resultOffset = stdout.lastIndexOf(resultMarker)
    expect(resultOffset).toBeGreaterThanOrEqual(0)
    const result = JSON.parse(
      stdout.slice(resultOffset + resultMarker.length),
    ) as {
      plugins: string[]
      rules: Array<{ loaders: string[]; test: string }>
    }

    expect(result.rules).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          test: '/preview\\.(t|j)sx?$/',
          loaders: expect.arrayContaining([
            expect.stringContaining('storybook-mock-transform-loader'),
          ]),
        }),
      ]),
    )
    expect(result.plugins).toEqual(
      expect.arrayContaining([
        'RspackMockPlugin',
        'RspackInjectMockerRuntimePlugin',
      ]),
    )
  })
})

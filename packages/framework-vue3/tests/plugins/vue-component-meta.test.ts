import type {
  RsbuildPluginAPI,
  TransformDescriptor,
  TransformHandler,
} from '@rsbuild/core'
import { describe, expect, it } from '@rstest/core'
import { experimental_vueDocgenEngine } from '@storybook/vue3/preset'
import { join, relative } from 'node:path'
import { getProjectRoot } from 'storybook/internal/common'
import { vueComponentMeta } from '../../src/plugins/vue-component-meta'

const fixtures = join(import.meta.dirname, '__fixtures__')

// Main module emitted by rspack-vue-loader for a <script setup> SFC.
const compiledSfc = `import script from "./Button.vue?vue&type=script&setup=true&lang.ts"
export * from "./Button.vue?vue&type=script&setup=true&lang.ts"
const __exports__ = script;
export default __exports__`

const setupPlugin = async () => {
  const plugin = await vueComponentMeta(
    await experimental_vueDocgenEngine(),
    relative(getProjectRoot(), join(fixtures, 'tsconfig.json')),
  )
  let transform: TransformHandler | undefined

  await plugin.setup({
    transform: (
      _descriptor: TransformDescriptor,
      handler: TransformHandler,
    ) => {
      transform = handler
    },
    onAfterCreateCompiler: () => {},
  } as unknown as RsbuildPluginAPI)

  return transform!
}

describe('vueComponentMeta', () => {
  it('attaches vue-component-meta docgen to the compiled SFC', async () => {
    const transform = await setupPlugin()

    const code = (await transform({
      code: compiledSfc,
      resourcePath: join(fixtures, 'Button.vue'),
    } as Parameters<TransformHandler>[0])) as string

    const [, json] = code.match(
      /__exports__\.__docgenInfo = Object\.assign\(\{[\s\S]*?\}, (\{[\s\S]*\})\)$/,
    )!
    const info = JSON.parse(json)

    expect(info.exportName).toBe('default')
    expect(info.props.map((prop: { name: string }) => prop.name)).toEqual(
      expect.arrayContaining(['label', 'size']),
    )
    expect(info.events.map((event: { name: string }) => event.name)).toEqual([
      'click',
    ])
  }, 60_000)
})

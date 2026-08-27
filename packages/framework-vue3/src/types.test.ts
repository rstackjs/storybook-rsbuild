import { describe, expect, it } from '@rstest/core'
import type { FrameworkOptions } from './types'

const portableDocgenOptions = [
  false,
  true,
  'vue-docgen-api',
  'vue-component-meta',
  {
    plugin: 'vue-component-meta',
    tsconfig: 'tsconfig.app.json',
  },
] satisfies NonNullable<FrameworkOptions['docgen']>[]

describe('FrameworkOptions', () => {
  it('accepts portable Vue docgen options', () => {
    expect(portableDocgenOptions).toHaveLength(5)
  })
})

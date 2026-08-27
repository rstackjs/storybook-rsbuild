import { describe, expect, it } from '@rstest/core'
import type { ComponentDoc } from 'vue-docgen-api'
import type {
  FrameworkOptions,
  VueDocgenInfo,
  VueDocgenInfoEntry,
} from '../src/types'

type ArrayElement<T> = T extends readonly (infer TElement)[] ? TElement : never

type Equal<TLeft, TRight> =
  (<T>() => T extends TLeft ? 1 : 2) extends <T>() => T extends TRight ? 1 : 2
    ? true
    : false

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

const publicDocgenTypeAssertions: [
  Equal<VueDocgenInfo<'vue-docgen-api'>, ComponentDoc>,
  Equal<VueDocgenInfo<'vue-component-meta'>, never>,
  Equal<
    VueDocgenInfoEntry<'vue-docgen-api', 'props'>,
    ArrayElement<ComponentDoc['props']>
  >,
  Equal<
    VueDocgenInfoEntry<'vue-docgen-api', 'events'>,
    ArrayElement<ComponentDoc['events']>
  >,
  Equal<
    VueDocgenInfoEntry<'vue-docgen-api', 'slots'>,
    ArrayElement<ComponentDoc['slots']>
  >,
  Equal<
    VueDocgenInfoEntry<'vue-docgen-api', 'expose'>,
    ArrayElement<ComponentDoc['expose']>
  >,
] = [true, true, true, true, true, true]

describe('FrameworkOptions', () => {
  it('accepts portable Vue docgen options', () => {
    expect(portableDocgenOptions).toHaveLength(5)
  })

  it('exports vue-docgen-api metadata types', () => {
    expect(publicDocgenTypeAssertions).toEqual([
      true,
      true,
      true,
      true,
      true,
      true,
    ])
  })
})

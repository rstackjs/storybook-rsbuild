import { describe, expect, it } from '@rstest/core'
import { unshiftIntoOneOf } from './rspack-helpers'

describe('unshiftIntoOneOf', () => {
  it('unshifts a branch into the first oneOf whose test matches', () => {
    const config = {
      module: {
        rules: [
          {
            test: /\.svg$/i,
            oneOf: [{ type: 'asset' }],
          },
        ],
      },
    }
    const branch = { issuer: /\.tsx?$/, use: [{ loader: 'svgr' }] }
    const mutated = unshiftIntoOneOf(config, /\\?\.svg/i, branch)
    expect(mutated).toBe(1)
    expect(config.module.rules[0].oneOf).toEqual([branch, { type: 'asset' }])
  })

  it('descends into nested rules / oneOf', () => {
    const config = {
      module: {
        rules: [
          {
            oneOf: [{ test: /\.svg$/, oneOf: [{ type: 'asset' }] }],
          },
        ],
      },
    }
    expect(unshiftIntoOneOf(config, /\\?\.svg/i, { use: 'x' })).toBe(1)
  })

  it('returns 0 when no matching rule has a oneOf', () => {
    const config = {
      module: { rules: [{ test: /\.svg$/, use: 'asset' }] },
    }
    expect(unshiftIntoOneOf(config, /\\?\.svg/i, { use: 'x' })).toBe(0)
  })

  it('initializes module.rules when missing', () => {
    const config: any = {}
    expect(unshiftIntoOneOf(config, /\\?\.svg/i, { use: 'x' })).toBe(0)
    expect(config.module.rules).toEqual([])
  })
})

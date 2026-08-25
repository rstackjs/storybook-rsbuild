import { describe, expect, it } from '@rstest/core'
import { createNavigation } from './index'

describe('createNavigation', () => {
  it('provides the Next.js 16.3 bfcacheId field', () => {
    expect(createNavigation({}).bfcacheId).toBe('0')
  })
})

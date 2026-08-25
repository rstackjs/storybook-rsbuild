import { beforeAll, describe, expect, it } from '@rstest/core'
import React, { useContext } from 'react'
import { createNavigation } from 'storybook-next-rsbuild/navigation.mock'
import {
  GlobalLayoutRouterContext,
  LayoutRouterContext,
} from '../next-internals'
import { AppRouterProvider } from './app-router-provider'

const { renderToStaticMarkup } = require('react-dom/server') as {
  renderToStaticMarkup(node: React.ReactNode): string
}

type CacheNodeValue = {
  rsc: React.ReactNode
  prefetchRsc: React.ReactNode
  prefetchHead: React.ReactNode
  head: React.ReactNode
  slots: Record<string, unknown> | null
  scrollRef: { current: boolean } | null
  bfcacheId: number
}

type GlobalContextValue = {
  tree: unknown
  focusAndScrollRef: {
    scrollRef: { current: boolean } | null
    forceScroll: boolean
    hashFragment: string | null
    onlyHashChange: boolean
  }
  nextUrl: string | null
  previousNextUrl: string | null
}

type LayoutContextValue = {
  parentTree: unknown
  parentCacheNode: CacheNodeValue
  parentSegmentPath: unknown | null
  parentParams: Record<string, string | string[] | undefined>
  parentLoadingData: React.ReactNode
  debugNameContext: string
  url: string
  isActive: boolean
}

let globalContextValue: GlobalContextValue
let layoutContextValue: LayoutContextValue

function ContextProbe() {
  globalContextValue = useContext(
    GlobalLayoutRouterContext,
  ) as GlobalContextValue
  const layoutContext = useContext(
    LayoutRouterContext,
  ) as LayoutContextValue | null
  if (!layoutContext) throw new Error('LayoutRouterContext was not provided')
  layoutContextValue = layoutContext
  return null
}

beforeAll(() => {
  createNavigation({})
  const originalWarn = console.warn
  console.warn = (message, ...args) => {
    // This repository still compiles JSX with the classic transform. React 19
    // warns once when the test renders it; preserve every other warning.
    if (String(message).includes('outdated JSX transform')) return
    originalWarn(message, ...args)
  }
  try {
    renderToStaticMarkup(
      <AppRouterProvider
        routeParams={{ pathname: '/stories', query: { view: 'grid' } }}
      >
        <ContextProbe />
      </AppRouterProvider>,
    )
  } finally {
    console.warn = originalWarn
  }
})

describe('AppRouterProvider Next.js 16.3 context values', () => {
  it('provides the GlobalLayoutRouterContext shape', () => {
    expect(Object.keys(globalContextValue)).toEqual([
      'tree',
      'focusAndScrollRef',
      'nextUrl',
      'previousNextUrl',
    ])
    expect(globalContextValue.focusAndScrollRef).toEqual({
      scrollRef: null,
      forceScroll: false,
      hashFragment: null,
      onlyHashChange: false,
    })
    expect(globalContextValue.nextUrl).toBe('/stories')
    expect(globalContextValue.previousNextUrl).toBeNull()
  })

  it('provides the LayoutRouterContext shape', () => {
    expect(Object.keys(layoutContextValue)).toEqual([
      'parentTree',
      'parentCacheNode',
      'parentSegmentPath',
      'parentParams',
      'parentLoadingData',
      'debugNameContext',
      'url',
      'isActive',
    ])
    expect(layoutContextValue.parentTree).toBe(globalContextValue.tree)
    expect(layoutContextValue).toMatchObject({
      parentSegmentPath: null,
      parentParams: {},
      parentLoadingData: null,
      debugNameContext: '/',
      url: '/stories',
      isActive: true,
    })
  })

  it('provides the Next.js 16.3 CacheNode shape', () => {
    expect(Object.keys(layoutContextValue.parentCacheNode)).toEqual([
      'rsc',
      'prefetchRsc',
      'prefetchHead',
      'head',
      'slots',
      'scrollRef',
      'bfcacheId',
    ])
    expect(layoutContextValue.parentCacheNode).toEqual({
      rsc: null,
      prefetchRsc: null,
      prefetchHead: null,
      head: null,
      slots: null,
      scrollRef: null,
      bfcacheId: 0,
    })
  })
})

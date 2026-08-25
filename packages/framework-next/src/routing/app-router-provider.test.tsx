import { beforeAll, describe, expect, it } from '@rstest/core'
import React, { useContext } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createNavigation } from 'storybook-next-rsbuild/navigation.mock'
import {
  GlobalLayoutRouterContext,
  LayoutRouterContext,
} from '../next-internals'
import { AppRouterProvider } from './app-router-provider'

type GlobalContextValue = React.ContextType<typeof GlobalLayoutRouterContext>
type LayoutContextValue = NonNullable<
  React.ContextType<typeof LayoutRouterContext>
>

let globalContextValue: GlobalContextValue
let layoutContextValue: LayoutContextValue

function ContextProbe() {
  globalContextValue = useContext(GlobalLayoutRouterContext)
  const layoutContext = useContext(LayoutRouterContext)
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

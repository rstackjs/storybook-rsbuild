import React, { useMemo } from 'react'
// Singleton import via package name
// @ts-expect-error we must ignore types here as during compilation they are not generated yet
import { getRouter } from 'storybook-next-rsbuild/navigation.mock'
import {
  AppRouterContext,
  type FlightRouterState,
  GlobalLayoutRouterContext,
  LayoutRouterContext,
  PathnameContext,
  PathParamsContext,
  SearchParamsContext,
} from '../next-internals'

import type { RouteParams } from './types'

type Params = Record<string, string | Array<string> | undefined>

type AppRouterProviderProps = {
  routeParams: RouteParams
}

const getParallelRoutes = (
  segmentsList: Array<string>,
  index = 0,
): FlightRouterState => {
  const segment = segmentsList[index]

  if (segment) {
    return [segment, { children: getParallelRoutes(segmentsList, index + 1) }]
  }

  return [] as any
}

export const AppRouterProvider: React.FC<
  React.PropsWithChildren<AppRouterProviderProps>
> = ({ children, routeParams }) => {
  const { pathname, query, segments = [] } = routeParams

  const tree: FlightRouterState = useMemo(
    () => [pathname, { children: getParallelRoutes(segments) }],
    [pathname, segments],
  )

  const pathParams = useMemo(() => {
    const src = routeParams.segments
    if (!src) return {} as Params

    // segments can be either [['key', value], …] tuples or a plain object
    if (Array.isArray(src)) {
      const params: Params = {}
      for (const entry of src) {
        if (
          Array.isArray(entry) &&
          entry.length === 2 &&
          typeof entry[0] === 'string'
        ) {
          params[entry[0]] = entry[1] as string | string[] | undefined
        }
      }
      return params
    }

    return { ...(src as Params) }
  }, [routeParams.segments])

  const cacheNode = useMemo(
    () => ({
      lazyData: null,
      rsc: null,
      prefetchRsc: null,
      head: null,
      prefetchHead: null,
      parallelRoutes: new Map(),
      loading: null,
    }),
    [],
  )

  const searchParams = useMemo(() => new URLSearchParams(query), [query])

  return (
    <PathParamsContext.Provider value={pathParams}>
      <PathnameContext.Provider value={pathname}>
        <SearchParamsContext.Provider value={searchParams}>
          <GlobalLayoutRouterContext.Provider
            value={{
              // @ts-expect-error (Only available in Next.js >= v15.1.1)
              changeByServerResponse() {},
              buildId: 'storybook',
              tree,
              focusAndScrollRef: {
                apply: false,
                hashFragment: null,
                segmentPaths: [tree],
                onlyHashChange: false,
              },
              nextUrl: pathname,
            }}
          >
            <AppRouterContext.Provider value={getRouter()}>
              <LayoutRouterContext.Provider
                value={{
                  childNodes: new Map(),
                  tree,
                  // @ts-expect-error Only available in Next.js >= v15.1.1
                  parentTree: tree,
                  // @ts-expect-error Only available in Next.js >= v15.1.1
                  parentCacheNode: cacheNode,
                  url: pathname,
                  loading: null,
                }}
              >
                {children}
              </LayoutRouterContext.Provider>
            </AppRouterContext.Provider>
          </GlobalLayoutRouterContext.Provider>
        </SearchParamsContext.Provider>
      </PathnameContext.Provider>
    </PathParamsContext.Provider>
  )
}

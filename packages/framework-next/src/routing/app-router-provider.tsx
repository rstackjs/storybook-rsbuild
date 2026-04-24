// Port: @storybook/nextjs-vite/src/routing/app-router-provider.tsx
import React, { useMemo } from 'react'
import { getRouter } from 'storybook-next-rsbuild/navigation.mock'
import {
  AppRouterContext,
  type FlightRouterState,
  GlobalLayoutRouterContext,
  LayoutRouterContext,
  PAGE_SEGMENT_KEY,
  PathnameContext,
  PathParamsContext,
  SearchParamsContext,
} from '../next-internals'

import type { RouteParams } from './types'

type Params = Record<string, string | Array<string> | undefined>

type AppRouterProviderProps = {
  routeParams: RouteParams
}

const getParallelRoutes = (segmentsList: Array<string>): FlightRouterState => {
  const segment = segmentsList.shift()
  if (segment) {
    return [segment, { children: getParallelRoutes(segmentsList) }]
  }
  return [] as any
}

/**
 * Mirrors Next.js's own param extraction (added in 14.2 via
 * vercel/next.js#60708) so dynamic `[id]`, catch-all `[...slug]`, and
 * optional catch-all `[[...slug]]` segments populate `useParams()`.
 */
function getSelectedParams(
  currentTree: FlightRouterState,
  params: Params = {},
): Params {
  const parallelRoutes = currentTree[1]

  for (const parallelRoute of Object.values(
    parallelRoutes,
  ) as FlightRouterState[]) {
    const segment = parallelRoute[0]
    const isDynamicParameter = Array.isArray(segment)
    const segmentValue = isDynamicParameter ? segment[1] : segment

    if (!segmentValue || segmentValue.startsWith(PAGE_SEGMENT_KEY)) {
      continue
    }

    const isCatchAll =
      isDynamicParameter && (segment[2] === 'c' || segment[2] === 'oc')

    if (isCatchAll) {
      params[segment[0]] = Array.isArray(segment[1])
        ? segment[1]
        : segment[1].split('/')
    } else if (isDynamicParameter) {
      params[segment[0]] = segment[1]
    }

    params = getSelectedParams(parallelRoute, params)
  }

  return params
}

export const AppRouterProvider: React.FC<
  React.PropsWithChildren<AppRouterProviderProps>
> = ({ children, routeParams }) => {
  const { pathname, query, segments = [] } = routeParams

  const tree: FlightRouterState = useMemo(
    () => [pathname, { children: getParallelRoutes([...segments]) }],
    [pathname, segments],
  )

  const pathParams = useMemo(() => {
    // Explicit segment tuples override anything derived from the tree
    const src = routeParams.segments
    if (Array.isArray(src) && src.length > 0 && Array.isArray(src[0])) {
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
    if (src && !Array.isArray(src) && typeof src === 'object') {
      return { ...(src as Params) }
    }
    return getSelectedParams(tree)
  }, [routeParams.segments, tree])

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
                  parentTree: tree,
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

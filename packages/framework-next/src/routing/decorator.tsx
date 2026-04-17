// Port: @storybook/nextjs-vite/src/routing/decorator.tsx
import * as React from 'react'
import type { Addon_StoryContext } from 'storybook/internal/types'
import { RedirectBoundary } from '../next-internals'

import { AppRouterProvider } from './app-router-provider'
import { PageRouterProvider } from './page-router-provider'
import type { NextAppDirectory, RouteParams } from './types'

const defaultRouterParams: RouteParams = {
  pathname: '/',
  query: {},
}

export const RouterDecorator = (
  Story: React.FC,
  { parameters }: Addon_StoryContext,
): React.ReactNode => {
  const nextAppDirectory =
    (parameters.nextjs?.appDirectory as NextAppDirectory | undefined) ?? false

  if (nextAppDirectory) {
    return (
      <AppRouterProvider
        routeParams={{
          ...defaultRouterParams,
          ...parameters.nextjs?.navigation,
        }}
      >
        <RedirectBoundary>
          <Story />
        </RedirectBoundary>
      </AppRouterProvider>
    )
  }

  return (
    <PageRouterProvider>
      <Story />
    </PageRouterProvider>
  )
}

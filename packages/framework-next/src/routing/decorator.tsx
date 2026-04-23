// Adapted from @storybook/nextjs-vite/src/routing/decorator.tsx
// Diverged: always mount BOTH AppRouterProvider and PageRouterProvider so a
// single Storybook setup serves projects that mix Pages and App Routers (the
// common case in Next.js 13+). Upstream gates on `parameters.nextjs.appDirectory`,
// which forces story authors to label every story and breaks mixed-router repos.
import * as React from 'react'
import type { Addon_StoryContext } from 'storybook/internal/types'
import { RedirectBoundary } from '../next-internals'

import { AppRouterProvider } from './app-router-provider'
import { PageRouterProvider } from './page-router-provider'
import type { RouteParams } from './types'

const defaultRouterParams: RouteParams = {
  pathname: '/',
  query: {},
}

export const RouterDecorator = (
  Story: React.FC,
  { parameters }: Addon_StoryContext,
): React.ReactNode => (
  <AppRouterProvider
    routeParams={{
      ...defaultRouterParams,
      ...parameters.nextjs?.navigation,
    }}
  >
    <RedirectBoundary>
      <PageRouterProvider>
        <Story />
      </PageRouterProvider>
    </RedirectBoundary>
  </AppRouterProvider>
)

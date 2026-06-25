// Port: @storybook/nextjs-vite/src/routing/page-router-provider.tsx
import type { PropsWithChildren } from 'react'
import React from 'react'
import { getRouter } from 'storybook-next-rsbuild/router.mock'
import { RouterContext } from '../next-internals'

export const PageRouterProvider: React.FC<PropsWithChildren> = ({
  children,
}) => (
  <RouterContext.Provider value={getRouter()}>
    {children}
  </RouterContext.Provider>
)

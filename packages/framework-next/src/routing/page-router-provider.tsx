import type { PropsWithChildren } from 'react'
import React from 'react'
// Singleton import via package name
// @ts-expect-error we must ignore types here as during compilation they are not generated yet
import { getRouter } from 'storybook-next-rsbuild/router.mock'
import { RouterContext } from '../next-internals'

export const PageRouterProvider: React.FC<PropsWithChildren> = ({
  children,
}) => (
  <RouterContext.Provider value={getRouter()}>
    {children}
  </RouterContext.Provider>
)

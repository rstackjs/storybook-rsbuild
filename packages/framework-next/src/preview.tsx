// Port: @storybook/nextjs-vite/src/preview.tsx
import type { ReactRenderer } from '@storybook/react'
import type * as React from 'react'
import type {
  Addon_DecoratorFunction,
  LoaderFunction,
} from 'storybook/internal/types'
import { createNavigation } from 'storybook-next-rsbuild/navigation.mock'
import { createRouter } from 'storybook-next-rsbuild/router.mock'
import { HeadManagerDecorator } from './head-manager/decorator'
import { ImageDecorator } from './images/decorator'
import { isNextRouterError } from './next-internals'
import { RouterDecorator } from './routing/decorator'
import { StyledJsxDecorator } from './styled-jsx/decorator'

// Suppression list mirrors Next.js's own client-index error filter.
// https://github.com/vercel/next.js/blob/a74deb63e310df473583ab6f7c1783bc609ca236/packages/next/src/client/app-index.tsx#L15
const ASYNC_CLIENT_ERRORS = [
  'Only Server Components can be async at the moment.',
  'A component was suspended by an uncached promise.',
  'async/await is not yet supported in Client Components',
]

function isSuppressedError(error: unknown): boolean {
  return (
    isNextRouterError(error) ||
    (typeof error === 'string' &&
      ASYNC_CLIENT_ERRORS.some((m) => error.includes(m)))
  )
}

if (!document.querySelector('meta[name="next-head-count"]')) {
  const meta = document.createElement('meta')
  meta.name = 'next-head-count'
  meta.content = '0'
  document.head.appendChild(meta)
}

// Anchor element that `next-style-loader` (Pages Router dev mode) inserts
// style tags before. Next.js renders it in `_document.js`; Storybook doesn't
// run the Next.js server, so we inject it manually.
if (!document.querySelector('#__next_css__DO_NOT_USE__')) {
  const anchor = document.createElement('noscript')
  anchor.id = '__next_css__DO_NOT_USE__'
  document.head.appendChild(anchor)
}

if (!(globalThis as any).__SB_NEXT_PATCHED) {
  const origConsoleError = globalThis.console.error
  globalThis.console.error = (...args: unknown[]) => {
    if (!isSuppressedError(args[0])) {
      origConsoleError.apply(globalThis.console, args)
    }
  }

  globalThis.addEventListener('error', (ev) => {
    if (isSuppressedError(ev.error)) ev.preventDefault()
  })

  ;(globalThis as any).__SB_NEXT_PATCHED = true
}

const asDecorator = (
  decorator: (Story: React.FC, context?: any) => React.ReactNode,
) => decorator as unknown as Addon_DecoratorFunction<ReactRenderer>

export const decorators: Addon_DecoratorFunction<ReactRenderer>[] = [
  asDecorator(StyledJsxDecorator),
  asDecorator(ImageDecorator),
  asDecorator(RouterDecorator),
  asDecorator(HeadManagerDecorator),
]

// Diverged from upstream: always seed both router mocks. The decorator mounts
// both AppRouterProvider and PageRouterProvider (see routing/decorator.tsx),
// so a story may consume `next/navigation` and `next/router` independently of
// any `parameters.nextjs.appDirectory` flag.
export const loaders: LoaderFunction<ReactRenderer> = async ({
  globals,
  parameters,
}) => {
  const { router } = parameters.nextjs ?? {}
  createNavigation(router)
  createRouter({
    locale: globals.locale,
    ...(router as Record<string, unknown>),
  })
}

export const parameters = {
  docs: {
    source: {
      excludeDecorators: true,
    },
  },
  react: {
    rootOptions: {
      onCaughtError(error: unknown) {
        if (isNextRouterError(error)) {
          return
        }
        console.error(error)
      },
    },
  },
}

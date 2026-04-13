/**
 * Centralized re-exports of Next.js internal modules (`next/dist/`).
 *
 * Next.js does not expose stable public APIs for framework integrations,
 * so Storybook must import from internal paths. This file funnels all such
 * imports into one place — when Next.js moves or renames an internal path,
 * only this file needs updating.
 *
 * NOT centralized here (must keep direct `next/dist/` paths):
 * - `export *` / `import *` re-exports in export-mocks (module identity matters)
 * - CJS loaders (`loaders/*.cjs`) that resolve `next` at runtime
 * - `next-config.ts` dynamic imports (already isolated in one function)
 */

// ---------------------------------------------------------------------------
// Shared runtime React contexts
// ---------------------------------------------------------------------------

export {
  AppRouterContext,
  GlobalLayoutRouterContext,
  LayoutRouterContext,
} from 'next/dist/shared/lib/app-router-context.shared-runtime.js'
export { HeadManagerContext } from 'next/dist/shared/lib/head-manager-context.shared-runtime.js'
export {
  PathnameContext,
  PathParamsContext,
  SearchParamsContext,
} from 'next/dist/shared/lib/hooks-client-context.shared-runtime.js'
export { ImageConfigContext } from 'next/dist/shared/lib/image-config-context.shared-runtime.js'
export { RouterContext } from 'next/dist/shared/lib/router-context.shared-runtime.js'

// ---------------------------------------------------------------------------
// Client components & utilities
// ---------------------------------------------------------------------------

export { isNextRouterError } from 'next/dist/client/components/is-next-router-error.js'
export { getRedirectError } from 'next/dist/client/components/redirect.js'

export { RedirectBoundary } from 'next/dist/client/components/redirect-boundary.js'
export { RedirectStatusCode } from 'next/dist/client/components/redirect-status-code.js'
export { default as initHeadManager } from 'next/dist/client/head-manager.js'

// ---------------------------------------------------------------------------
// Server internals
// ---------------------------------------------------------------------------

export { draftMode } from 'next/dist/server/request/draft-mode.js'

export { HeadersAdapter } from 'next/dist/server/web/spec-extension/adapters/headers.js'

// ---------------------------------------------------------------------------
// Compiled third-party dependencies bundled by Next.js
// ---------------------------------------------------------------------------

export { RequestCookies } from 'next/dist/compiled/@edge-runtime/cookies/index.js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type { FlightRouterState } from 'next/dist/server/app-render/types'

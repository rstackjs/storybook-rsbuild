/**
 * Centralized re-exports of Next.js internal modules (`next/dist/`). Next.js
 * doesn't expose stable public APIs for framework integrations, so we funnel
 * all internal imports here — one place to update when Next.js moves a path.
 *
 * NOT centralized (must keep direct `next/dist/` paths):
 * - `export *` / `import *` in export-mocks (module identity matters)
 * - CJS loaders that resolve `next` at runtime
 * - `next-config.ts` dynamic imports
 */

export { isNextRouterError } from 'next/dist/client/components/is-next-router-error.js'
export { getRedirectError } from 'next/dist/client/components/redirect.js'
export { RedirectBoundary } from 'next/dist/client/components/redirect-boundary.js'
export { RedirectStatusCode } from 'next/dist/client/components/redirect-status-code.js'
export { default as initHeadManager } from 'next/dist/client/head-manager.js'
export { RequestCookies } from 'next/dist/compiled/@edge-runtime/cookies/index.js'
export type { FlightRouterState } from 'next/dist/server/app-render/types'
export { draftMode } from 'next/dist/server/request/draft-mode.js'
export { HeadersAdapter } from 'next/dist/server/web/spec-extension/adapters/headers.js'
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
export { PAGE_SEGMENT_KEY } from 'next/dist/shared/lib/segment.js'

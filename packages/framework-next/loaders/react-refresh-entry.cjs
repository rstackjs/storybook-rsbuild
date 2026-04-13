/**
 * React Refresh runtime entry — injected as a global entry so that
 * `RefreshRuntime.injectIntoGlobalHook(self)` runs before any component module.
 *
 * Uses Next.js's bundled react-refresh to avoid requiring a separate
 * react-refresh dependency.
 *
 * @see https://github.com/vercel/next.js/blob/canary/packages/react-refresh-utils/rspack-runtime.ts
 */

var RefreshRuntime = require('next/dist/compiled/react-refresh/runtime')
var INJECTED_KEY = '__reactRefreshInjected'

if (typeof self !== 'undefined' && !self[INJECTED_KEY]) {
  RefreshRuntime.injectIntoGlobalHook(self)

  // Fallback no-ops for modules that aren't processed by builtin:react-refresh-loader
  self.$RefreshSig$ = () => (type) => type
  self.$RefreshReg$ = () => {}

  self[INJECTED_KEY] = true
}

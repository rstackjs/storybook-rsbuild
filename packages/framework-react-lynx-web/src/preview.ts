import { simulateDOMContentLoaded } from 'storybook/preview-api'

// NOTE: Side-effect imports of `@lynx-js/web-core` and `@lynx-js/web-elements/all`
// live in a SEPARATE preview entry (`./preview-runtime.ts`) and NOT this file.
// Why: `@lynx-js/web-core` uses top-level await (WASM init), which makes any
// importer an async module in webpack/rspack. Storybook's composeConfigs
// reads `render`/`renderToCanvas` synchronously via `__webpack_require__` —
// for async modules that returns a Promise, not the exports object, so the
// getters return `undefined` and our `render` silently loses to the renderer
// default (`@storybook/web-components`), producing the confusing
// "component annotation is missing" error. Keeping this file sync preserves
// the exports; the async runtime file is listed earlier in previewAnnotations
// by preset.ts so its side effects still run.

interface LynxViewElement extends HTMLElement {
  url: string
  globalProps: Record<string, unknown>
  /** Incrementally update globalProps without full reload. */
  updateGlobalProps(data: Record<string, unknown>): void
}

// Dev-only CSS hot reload for <lynx-view>.
//
// What has HMR out of the box, what doesn't:
//   - **JS edits**: rsbuild's standard WebSocket HMR client is embedded in the
//     web bundle (pluginReactLynx only skips its *own* HMR prepends for the
//     `web` env — see lynx-stack
//     `packages/rspeedy/plugin-react/src/entry.ts`). Background-thread edits
//     therefore get real HMR with state preservation, no full reload.
//   - **CSS / main-thread script edits**: there is no upstream HMR path.
//     Without this shim, a CSS change shows only after a hard refresh.
//
// The SSE server in preset.ts filters rebuilds to CSS-only before pinging
// here (via `stats.compilation.modifiedFiles`), so JS-only rebuilds skip
// this path entirely and rsbuild's HMR handles them without interference.
//
// `?t=` cache-bust: @lynx-js/web-core's TemplateManager keys its bundle
// cache by URL string (`#bundles: Map<string, DecodedTemplate>` in
// `packages/web-platform/web-core/ts/client/mainthread/TemplateManager.ts`,
// `fetchBundle` at ≈ L47 returns the cached entry on hit) and exposes no
// public invalidation API. Mutating the URL query is the only way to force
// a re-fetch from outside web-core.
//
// Rsbuild replaces `process.env.NODE_ENV` at build time, so this whole
// block is dead-code-eliminated in production — otherwise the prod bundle
// would open an EventSource to a non-existent `/__lynx_hmr__` handler and
// reconnect endlessly.
if (process.env.NODE_ENV !== 'production') {
  try {
    const es = new EventSource('/__lynx_hmr__')
    es.addEventListener('message', (e) => {
      if (e.data !== 'content-changed') return
      const lynxView = document.querySelector(
        'lynx-view',
      ) as LynxViewElement | null
      if (lynxView?.url) reloadLynxView(lynxView)
    })
  } catch {
    /* SSE not available, ignore */
  }
}

/**
 * Force <lynx-view> to re-fetch its template, bypassing web-core's URL cache.
 * See note on `?t=` above.
 */
function reloadLynxView(view: LynxViewElement) {
  const baseUrl = view.url.split('?')[0]
  view.url = `${baseUrl}?t=${Date.now()}`
}

/**
 * Build a **detached** <lynx-view> with its `url` attribute already set, so
 * `connectedCallback` sees a url on its very first run.
 *
 * TODO: remove this dance once upstream fixes the LynxView `#rendering`
 * latch. Until then, the ordering below is load-bearing — appending first
 * and assigning `.url = x` after silently produces a blank shadow root on
 * the first story visit.
 *
 * Background (lynx-stack @ web-core 0.19.x,
 * `packages/web-platform/web-core/ts/client/mainthread/LynxView.ts`):
 *
 *   - `connectedCallback` (≈ L492) calls `#render()` unconditionally.
 *   - `#render()` (≈ L417) is gated on `!#rendering && #connected`. It
 *     flips `#rendering = true`, then queues a microtask whose `#url`
 *     branch (≈ L437) is the *only* path that ever writes
 *     `#rendering = false` again (≈ L475).
 *   - `attributeChangedCallback` (≈ L355) writes `#url` synchronously and
 *     does NOT call `#render()`; only the `url` setter (L187) does.
 *
 * Consequence: if the element is appended with no `url` attribute, the
 * microtask no-ops, `#rendering` stays `true` forever, and a subsequent
 * `lv.url = 'foo'` triggers `#render()` which immediately bails on the
 * `!#rendering` guard — the bundle is never fetched.
 *
 * Fix: push the url through `setAttribute('url', ...)` *before* appendChild.
 * `attributeChangedCallback` populates `#url` synchronously, so when
 * `connectedCallback` fires the first `#render()` reaches the `#url` branch
 * and resets `#rendering` on the happy path.
 */
function createLynxView(
  lynxUrl: string,
  globalProps: Record<string, unknown>,
): LynxViewElement {
  const lynxView = document.createElement('lynx-view') as LynxViewElement
  lynxView.setAttribute(
    'style',
    'display: block; width: 100%; min-height: 200px;',
  )
  lynxView.setAttribute('global-props', JSON.stringify(globalProps))
  lynxView.globalProps = globalProps
  lynxView.setAttribute('url', lynxUrl)
  return lynxView
}

/**
 * Default render function for ReactLynx Web stories.
 * Returns a DOM element that renderToCanvas will manage.
 */
export function render(args: Record<string, unknown>, context: any) {
  const { id, parameters } = context
  const lynxUrl = parameters?.lynx?.url

  if (!lynxUrl) {
    const el = document.createElement('div')
    el.style.cssText =
      'padding: 20px; color: #999; font-family: sans-serif; text-align: center;'
    el.textContent = `Story "${id}" is missing parameters.lynx.url — specify the path to a .web.bundle file.`
    return el
  }

  return createLynxView(lynxUrl, args ?? {})
}

/**
 * Custom renderToCanvas that preserves <lynx-view> state across args changes.
 *
 * When only Storybook controls changed (not a story switch), we call
 * updateGlobalProps() on the existing <lynx-view> instead of replacing
 * the DOM node. This avoids disconnectedCallback/connectedCallback which
 * would destroy and recreate the Lynx runtime, losing component state.
 */
export function renderToCanvas(
  {
    storyFn,
    showMain,
    forceRemount,
  }: {
    storyFn: () => HTMLElement
    showMain: () => void
    forceRemount: boolean
  },
  canvasElement: HTMLElement,
) {
  const existingLynxView = canvasElement.querySelector(
    'lynx-view',
  ) as LynxViewElement | null

  showMain()

  // Reuse path: existing <lynx-view> is loaded and this is not a story switch.
  // Extract args from the new render call and push them via updateGlobalProps.
  if (existingLynxView?.url && !forceRemount) {
    const element = storyFn()
    if (element instanceof HTMLElement && element.tagName === 'LYNX-VIEW') {
      const newProps = (element as LynxViewElement).globalProps ?? {}
      existingLynxView.updateGlobalProps(newProps)
      return
    }
  }

  // Fresh render: clear canvas and mount the new element. The <lynx-view>
  // returned by storyFn already has `url` set, so appendChild triggers
  // connectedCallback → #render() → bundle fetch in one shot.
  canvasElement.innerHTML = ''
  const element = storyFn()
  if (element instanceof Node) {
    canvasElement.appendChild(element)
    simulateDOMContentLoaded()
  }
}

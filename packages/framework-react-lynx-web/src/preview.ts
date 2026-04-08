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

/**
 * Framework-level default parameters. `layout: 'fullscreen'` makes the
 * preview canvas fill the iframe so the Storybook-owned `lynx-view { width:
 * 100%; height: 100% }` rule injected in `./preview-runtime.ts` can expand
 * the custom element to the full viewport. Users can still override this
 * per-story (e.g. `parameters: { layout: 'centered' }`) — Storybook
 * composes preview-annotation `parameters` with last-write-wins semantics.
 */
export const parameters = {
  layout: 'fullscreen' as const,
}

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
  // Sizing/display comes from the framework-injected stylesheet in
  // `./preview-runtime.ts` (plus `@lynx-js/web-core/index.css`), not from
  // an inline style here. Keeping the element unstyled lets consumers
  // override the viewport via `parameters.layout` or their own CSS
  // without fighting an inline cascade.
  //
  // We only set the `globalProps` property (not the `global-props`
  // attribute): LynxView observes the property for reactive updates, and
  // the attribute path would re-serialize through JSON and lose any
  // non-JSON-safe values. See lynx-stack
  // packages/web-platform/web-core/ts/client/mainthread/LynxView.ts.
  //
  // Precondition: callers must ensure `customElements.get('lynx-view')`
  // is already defined (i.e. preview-runtime.ts has finished its WASM
  // init TLA). Otherwise `document.createElement` returns a placeholder
  // HTMLElement and `lynxView.globalProps = x` writes an own data
  // property that shadows LynxView's accessor. `renderToCanvas` enforces
  // this via `await customElements.whenDefined('lynx-view')` — see the
  // long comment there for the full failure mode.
  lynxView.globalProps = globalProps
  lynxView.setAttribute('url', lynxUrl)
  return lynxView
}

/**
 * Render a friendly error panel inside the preview canvas when the bundle
 * fetch, WASM init, or background-worker startup fails. Without this the
 * preview would just show an empty `<lynx-view>` with no hint at what went
 * wrong.
 */
function renderErrorPanel(
  canvasElement: HTMLElement,
  title: string,
  detail: string,
): void {
  canvasElement.innerHTML = ''
  const panel = document.createElement('div')
  panel.setAttribute('data-lynx-error', '')
  panel.style.cssText =
    'padding: 24px; font-family: -apple-system, BlinkMacSystemFont, ' +
    '"Segoe UI", sans-serif; color: #b00020; background: #fff3f3; ' +
    'border: 1px solid #ffcdd2; border-radius: 6px; margin: 16px;'
  const h = document.createElement('strong')
  h.textContent = title
  h.style.display = 'block'
  h.style.marginBottom = '8px'
  panel.appendChild(h)
  const body = document.createElement('pre')
  body.textContent = detail
  body.style.cssText =
    'margin: 0; white-space: pre-wrap; font-family: ui-monospace, ' +
    'SFMono-Regular, Menlo, monospace; font-size: 12px; color: #5a0f17;'
  panel.appendChild(body)
  canvasElement.appendChild(panel)
}

/**
 * Subscribe to the failure surfaces of `<lynx-view>` and route them to
 * `renderErrorPanel`. Lynx surfaces failures via three channels:
 *
 *   1. DOM `error` events bubbling from the element (bundle 404, CORS,
 *      syntax error in the bundle, worker boot failure).
 *   2. The `onNativeModulesCall` path when the main thread throws (we
 *      don't hook that here — it's a runtime concern, not a preview
 *      concern).
 *   3. Unhandled Promise rejection inside the worker (we can't catch
 *      those from the host frame at all; the user has to rely on devtools).
 *
 * We cover (1) because that is where >95% of first-time failures land
 * ("I pointed `parameters.lynx.url` at the wrong path" / "the rspeedy
 * build hasn't finished yet").
 */
function attachErrorListener(
  lynxView: LynxViewElement,
  canvasElement: HTMLElement,
): void {
  lynxView.addEventListener(
    'error',
    (event) => {
      const anyEvent = event as Event & {
        detail?: unknown
        message?: string
        error?: { message?: string; stack?: string }
      }
      const msg =
        anyEvent.error?.message ??
        anyEvent.message ??
        (typeof anyEvent.detail === 'string' ? anyEvent.detail : undefined) ??
        'Failed to load Lynx bundle'
      renderErrorPanel(
        canvasElement,
        `Lynx bundle failed to load`,
        `URL: ${lynxView.url}\n\n${msg}${
          anyEvent.error?.stack ? `\n\n${anyEvent.error.stack}` : ''
        }`,
      )
    },
    // capture so we see the event even if the shadow DOM stops propagation
    { capture: true },
  )
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
 *
 * ASYNC / `await customElements.whenDefined('lynx-view')` — load-bearing.
 *
 * Background. `preview-runtime.ts` is the async sibling module that
 * registers `<lynx-view>` via a side-effect import of `@lynx-js/web-core`.
 * web-core uses top-level await for its WASM init, so the registration
 * does not complete until that init resolves. Our preview module itself
 * is sync (see the long note at the top of this file), so Storybook reads
 * `render`/`renderToCanvas` off our exports immediately — potentially
 * BEFORE preview-runtime.ts has finished its TLA and called
 * `customElements.define('lynx-view', LynxView)`.
 *
 * On the first story render of a fresh page this race usually resolves
 * itself because Storybook's own preview bootstrap (manager handshake,
 * composeConfigs, story store hydration) takes long enough for the
 * registration to land. On a SECOND page reload in the same browser
 * session the race inverts: preview.ts's sync exports are served from
 * module cache almost instantly while preview-runtime.ts still has to
 * go through WASM instantiation, and `createLynxView` runs with
 * `customElements.get('lynx-view')` still returning `undefined`.
 *
 * In that pre-upgrade window `document.createElement('lynx-view')` gives
 * us a plain HTMLElement. `lynxView.globalProps = x` writes an own data
 * property (no setter exists yet). Later when `customElements.define`
 * finally runs and upgrades the element, LynxView's `connectedCallback`
 * (lynx-stack packages/web-platform/web-core/ts/client/mainthread/
 * LynxView.ts ≈ L492) calls `#upgradeProperty` for `browserConfig`,
 * `transformVW`, and `transformVH` — but **not** for `globalProps`. The
 * own data property stays in place shadowing the accessor, the private
 * `#globalProps` field keeps its `{}` default, and anywhere the LynxView
 * internals read the private field (or pass a stale snapshot through
 * the worker init message) the story ends up rendering with empty /
 * default props. User-visible symptom: story args are ignored on second
 * load (e.g. `Primary` renders with the `Secondary` button class).
 *
 * Fix: make this function async and gate the whole render on
 * `whenDefined`. On the first render we wait at most as long as
 * preview-runtime's TLA was going to take anyway — so no user-observable
 * latency — and from then on it's a resolved microtask. Every subsequent
 * `createLynxView` call is guaranteed to hit an upgraded LynxView
 * instance and go through the class setter path.
 */
export async function renderToCanvas(
  context: {
    storyFn: () => HTMLElement
    showMain: () => void
    forceRemount: boolean
  },
  canvasElement: HTMLElement,
) {
  // TODO(verify): `whenDefined` race fix was only exercised in `pnpm
  // storybook` (dev) with a page-reload navigation pattern. Still needs
  // a pass with `pnpm build:storybook` + static preview, and with
  // in-manager sidebar navigation between stories (no iframe reload).
  // The dev + fresh-page path is covered.
  await customElements.whenDefined('lynx-view')

  const { storyFn, showMain, forceRemount } = context
  const existingLynxView = canvasElement.querySelector(
    'lynx-view',
  ) as LynxViewElement | null

  showMain()

  // Reuse path: existing <lynx-view> is loaded and this is not a story switch.
  // Extract args from the new render call and push them via updateGlobalProps.
  //
  // TODO(verify): the reuse branch itself has not been re-tested after the
  // `whenDefined` fix. Two scenarios to cover:
  //   1. Wiggling a Storybook control on the same story — should hit this
  //      path and live-update the shadow DOM without tearing down
  //      `<lynx-view>`. Known-related upstream caveat: a component that
  //      reads `lynx.__globalProps` non-reactively (as the current sandbox
  //      Button.tsx does) will not re-render on `updateGlobalProps`
  //      because there is no React state subscription — the class name
  //      will stay on whatever primary/secondary value was baked in at
  //      first render. The reactive path is `useGlobalProps()` from
  //      `@lynx-js/react`. Framework behavior is still correct; it's a
  //      user-code pitfall that should probably be documented.
  //   2. In-manager sidebar click between Primary/Secondary — Storybook
  //      may or may not pass `forceRemount: true` here; if not, we go
  //      through `updateGlobalProps` and hit caveat (1).
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
    if (element instanceof HTMLElement && element.tagName === 'LYNX-VIEW') {
      attachErrorListener(element as LynxViewElement, canvasElement)
    }
    canvasElement.appendChild(element)
    simulateDOMContentLoaded()
  }
}

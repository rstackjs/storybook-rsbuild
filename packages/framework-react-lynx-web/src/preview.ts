import { simulateDOMContentLoaded } from 'storybook/preview-api'

// Compile-time global injected by `preset.ts`'s `source.define`. It is static
// for the life of a Storybook process: it reflects the presence of a
// `.storybook/lynx-preview.*` registry at startup and is NOT reactive to
// dev-time edits of the registry afterwards (a change requires restarting
// Storybook anyway, since rspeedy only re-reads the entry at startup).

/** URL of the framework-driven dispatcher bundle, or `null` if the user did
 * not author a `.storybook/lynx-preview.*` registry. */
declare const __LYNX_STORYBOOK_ENTRY__: string | null

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

// Dev-time reload is handled outside this file — see `preview-runtime.ts` and
// `preset.ts`.
//
// Two independent pipelines, by edit kind:
//   - A *story* edit rebuilds only Storybook's preview bundle. The builder's
//     own HMR soft-updates the story store (`onStoriesChanged`) with no reload;
//     `renderToCanvas` remounts `<lynx-view>` so changed args/initial props
//     actually take effect. (This only works because the mount stops rspeedy's
//     middleware from shadowing the preview's `*.hot-update.json` files — see
//     `app.use` guard in `preset.ts`'s `experimental_devServer`.)
//   - A *component* source edit rebuilds the user's `.web.bundle`. The `web`
//     env has no React Fast-Refresh (entry.ts gates it off), and rsbuild's HMR
//     client embedded in the bundle runs inside web-core's Worker, where it
//     cannot reload the host iframe. So `preview-runtime.ts` opens a
//     main-thread listener on the mounted `/lynx-hmr` socket and reloads the
//     iframe when the lynx compilation hash changes, re-fetching the template
//     through web-core. No SSE bridge and no `?t=` cache-bust.

/**
 * Build a **detached** <lynx-view> with its `url` attribute already set, so
 * `connectedCallback` sees a url on its very first run.
 *
 * Defensive invariant: assign the url via `setAttribute('url', ...)` *before*
 * `appendChild`. Earlier web-core (0.19.x) had a `#rendering`-latch race where
 * appending the element first and assigning `.url` afterwards left the shadow
 * root blank on the first story visit — the first `#render()` flipped the
 * latch but, with no url yet, never reset it, so the later url assignment
 * bailed on the latch guard and never fetched the bundle. The pinned 0.21.0
 * routes the `url` attribute through a setter that re-renders, so the latch no
 * longer sticks; but setting the url before connect is still the cheapest way
 * to guarantee a populated first render and costs nothing, so we keep it. See
 * `packages/web-platform/web-core/ts/client/mainthread/LynxView.ts` upstream.
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
 * Subscribe to `<lynx-view>`'s DOM `error` event and route it to
 * `renderErrorPanel`. web-core dispatches this `CustomEvent` for runtime
 * exceptions thrown inside the bundle (main-thread JS errors and
 * resource-loader failures), carrying the payload on `event.detail` — as
 * `.error` (an `Error`), `.errorMsg`, or `.msg`/`.from`/`.code` depending on
 * the channel. (Reading `event.error`/`event.message` here would always miss
 * it and fall through to a generic message.)
 *
 * This does NOT cover a failed bundle *fetch* / decode: web-core surfaces
 * those as a rejected main-thread promise (TemplateManager), not as a DOM
 * `error` event, so they only show in the devtools console. Covering them
 * would need a `window` `unhandledrejection` listener, which risks false
 * positives from unrelated rejections — out of scope here.
 */
function attachErrorListener(
  lynxView: LynxViewElement,
  canvasElement: HTMLElement,
): void {
  lynxView.addEventListener(
    'error',
    (event) => {
      const detail = (event as Event & { detail?: unknown }).detail as
        | {
            error?: { message?: string; stack?: string } | string
            errorMsg?: string
            msg?: string
            from?: string
            code?: number
          }
        | string
        | undefined

      let message = ''
      let stack: string | undefined
      if (typeof detail === 'string') {
        message = detail
      } else if (detail) {
        const err = detail.error
        if (err && typeof err === 'object') {
          message = err.message ?? ''
          stack = err.stack
        } else if (typeof err === 'string') {
          message = err
        }
        if (!message) message = detail.errorMsg ?? detail.msg ?? ''
        if (!message && detail.from) {
          message =
            `Resource error from ${detail.from}` +
            (detail.code != null ? ` (code ${detail.code})` : '')
        }
      }
      if (!message) message = 'Lynx runtime error (see the devtools console)'

      renderErrorPanel(
        canvasElement,
        'Lynx runtime error',
        `URL: ${lynxView.url}\n\n${message}${stack ? `\n\n${stack}` : ''}`,
      )
    },
    // capture so we see the event even if the shadow DOM stops propagation
    { capture: true },
  )
}

/**
 * Resolve the bundle URL for a story from `parameters.lynx`. Two forms are
 * supported, in priority order:
 *
 *   1. `parameters.lynx.component: 'Button'` — the normal path. Points at the
 *      framework-driven dispatcher bundle and writes the name into
 *      `globalProps.__storybookComponent`, which the runtime dispatcher from
 *      `storybook-react-lynx-web-rsbuild/runtime` uses to render the matching
 *      component (with the story's args spread as props). Requires a
 *      `.storybook/lynx-preview.*` registry; otherwise `__LYNX_STORYBOOK_ENTRY__`
 *      is `null` and resolution surfaces an error explaining how to add it.
 *   2. `parameters.lynx.url: '/path/to/Button.web.bundle'` — the explicit
 *      escape hatch for a hand-hosted bundle (remote URL, custom prefix, or a
 *      bundle outside the framework's hosting).
 *
 * The returned shape flags `storybookEntryMissing` so the caller can tell
 * "no URL at all" from "a component was requested but no registry exists" and
 * render a targeted error. A *wrong* component name is NOT validated here —
 * the registry's real keys only exist at runtime, so the dispatcher
 * (`./runtime.ts`) renders a visible unknown-component error itself.
 */
function resolveLynxUrl(parameters: {
  lynx?: { url?: string; component?: string }
}): {
  url: string | undefined
  storybookEntryMissing?: boolean
} {
  const url = parameters?.lynx?.url
  const component = parameters?.lynx?.component
  if (url) return { url }
  if (component) {
    if (__LYNX_STORYBOOK_ENTRY__ == null) {
      // User asked for the dispatcher path but never authored the
      // registry file. Return no URL and flag the error so
      // `formatMissingUrlMessage` can explain how to fix it.
      return { url: undefined, storybookEntryMissing: true }
    }
    return { url: __LYNX_STORYBOOK_ENTRY__ }
  }
  return { url: undefined }
}

/**
 * Format the error shown when a story resolves to no bundle URL: it either
 * requested a `component` but no `.storybook/lynx-preview.*` registry exists,
 * or it set neither `component` nor the `url` escape hatch. (A *wrong*
 * component name is reported by the runtime dispatcher instead — see
 * `resolveLynxUrl`.)
 */
function formatMissingUrlMessage(
  storyId: string,
  opts: {
    badComponent?: string
    storybookEntryMissing?: boolean
  } = {},
): string {
  const { badComponent, storybookEntryMissing } = opts

  if (storybookEntryMissing) {
    const name = badComponent ?? 'Button'
    return (
      `Story "${storyId}" set parameters.lynx.component = ` +
      `${JSON.stringify(badComponent)}, but no .storybook/lynx-preview ` +
      `registry was found.\n\n` +
      `Create .storybook/lynx-preview.tsx (or .ts/.jsx/.js) next to your ` +
      `main.ts and register your components:\n\n` +
      `  import { createLynxStorybook } from 'storybook-react-lynx-web-rsbuild/runtime'\n` +
      `  import { ${name} } from '../src/components/${name}'\n` +
      `  createLynxStorybook({ components: { ${name} } })\n\n` +
      `then restart Storybook. Story args are spread onto the component as ` +
      `props automatically.`
    )
  }

  return (
    `Story "${storyId}" is missing parameters.lynx.component ` +
    `(or the parameters.lynx.url escape hatch).\n\n` +
    `Register components in .storybook/lynx-preview.* via ` +
    `\`createLynxStorybook({ components })\`, then set ` +
    `parameters.lynx.component to one of the registered names.`
  )
}

/**
 * Default render function for ReactLynx Web stories.
 * Returns a DOM element that renderToCanvas will manage.
 */
export function render(args: Record<string, unknown>, context: any) {
  const { id, parameters } = context
  const { url: lynxUrl, storybookEntryMissing } = resolveLynxUrl(
    parameters ?? {},
  )

  if (!lynxUrl || storybookEntryMissing) {
    const el = document.createElement('div')
    el.style.cssText =
      'padding: 20px; color: #b00020; background: #fff3f3; ' +
      'border: 1px solid #ffcdd2; border-radius: 6px; margin: 16px; ' +
      'font-family: ui-monospace, SFMono-Regular, Menlo, monospace; ' +
      'font-size: 12px; white-space: pre-wrap;'
    el.textContent = formatMissingUrlMessage(id, {
      badComponent: parameters?.lynx?.component,
      storybookEntryMissing,
    })
    return el
  }

  // When the user picks the dispatcher path, write the component name
  // into `globalProps.__storybookComponent` alongside the story's own
  // args. The dispatcher (see `./runtime.ts`) reads that key and
  // renders the matching component; the user's own component reads
  // everything else.
  //
  // Piggy-backing on `globalProps` (rather than a separate channel)
  // means the existing `updateGlobalProps` reuse path in
  // `renderToCanvas` forwards the name for free — no new runtime
  // surface needed. See the `Dispatcher` comment in `./runtime.ts` for
  // the reactivity model.
  const component = parameters?.lynx?.component
  const globalProps = component
    ? { ...(args ?? {}), __storybookComponent: component }
    : (args ?? {})
  return createLynxView(lynxUrl, globalProps)
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
 * go through WASM instantiation, and `createLynxView` would run with
 * `customElements.get('lynx-view')` still returning `undefined`.
 *
 * In that pre-upgrade window `document.createElement('lynx-view')` returns
 * a plain HTMLElement, so `lynxView.globalProps = x` writes an own data
 * property before any accessor exists. Depending on web-core's upgrade path
 * that own property can shadow the real `globalProps` accessor after the
 * element upgrades, leaving the story rendering with empty/default props
 * (observed symptom: story args ignored on a second page load). Gating on
 * `whenDefined` sidesteps the whole window — we only ever `createElement` an
 * already-registered LynxView, so the assignment always hits the class setter.
 *
 * Cost is negligible: on the first render we wait at most as long as
 * preview-runtime's TLA was going to take anyway, and thereafter it is a
 * resolved microtask.
 */
export async function renderToCanvas(
  context: {
    storyFn: () => HTMLElement
    showMain: () => void
    forceRemount: boolean
  },
  canvasElement: HTMLElement,
) {
  await customElements.whenDefined('lynx-view')

  const { storyFn, showMain, forceRemount } = context
  const existingLynxView = canvasElement.querySelector(
    'lynx-view',
  ) as LynxViewElement | null

  showMain()

  // Reuse path: same story, args changed (e.g. user wiggled a control).
  // Storybook does NOT force-remount in this case — the iframe URL updates
  // via history.replaceState, no reload, and renderToCanvas is called
  // again with the existing `<lynx-view>` still in `canvasElement`.
  //
  // We push the new args through `updateGlobalProps` instead of replacing
  // the element. That avoids tearing down the Lynx runtime (worker boot,
  // WASM init, bundle fetch) and preserves state inside the bundle's
  // React tree (counters, local state). The lynx-stack main-thread
  // `updateGlobalProps` calls `__FlushElementTree` / `runWithForce(render)`
  // which re-renders the bundle's React tree from root, so even
  // components that read `lynx.__globalProps` non-reactively still pick
  // up the new value — no `useGlobalProps()` requirement on user code.
  //
  // Story switches do NOT take this reuse path: Storybook starts a fresh
  // StoryRender whose first render passes forceRemount=true, so the guard
  // falls through to the fresh-render branch below (which clears the canvas
  // and mounts a new <lynx-view>). It's forceRemount — not an iframe reload —
  // that tells a switch apart from an in-place args change.
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

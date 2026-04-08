// @ts-expect-error -- ?inline import resolves CSS to a string at build time
import webElementsCSS from '@lynx-js/web-elements/index.css?inline'
import { simulateDOMContentLoaded } from 'storybook/preview-api'

// Inject web-elements CSS as a <link> element in document.head.
// <lynx-view> copies document <link rel="stylesheet"> into its shadow DOM
// via inject-head-links. Without this, layout CSS (linear.css, flex toggles)
// is not available inside the shadow root.
const webElementsLink = document.createElement('link')
webElementsLink.rel = 'stylesheet'
webElementsLink.href = URL.createObjectURL(
  new Blob([webElementsCSS], { type: 'text/css' }),
)
document.head.appendChild(webElementsLink)

interface LynxViewElement extends HTMLElement {
  url: string
  globalProps: Record<string, unknown>
  /** Incrementally update globalProps without full reload. */
  updateGlobalProps(data: Record<string, unknown>): void
}

// Subscribe to rspeedy rebuild events via SSE and force-reload <lynx-view>.
// The trigger is driven by rspeedy's compiler `onDevCompileDone` hook (in
// preset.ts), which broadcasts on every rebuild — this covers both TSX and
// CSS edits, since pluginReactLynx disables per-asset HMR for the `web` env
// (see lynx-stack packages/rspeedy/plugin-react/src/entry.ts).
//
// `?t=` cache-bust workaround: @lynx-js/web-core's TemplateManager caches
// bundles by URL string and exposes no public invalidation API. Until
// upstream ships one, mutating the URL is the only way to force re-fetch.
// Tracking issue: TODO upstream link.
//
// Rsbuild replaces process.env.NODE_ENV at build time, so the entire block
// is dead-code-eliminated in production bundles (no /__lynx_hmr__ handler
// exists in prod, and an EventSource would reconnect endlessly).
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
 * Create a fresh, **detached** <lynx-view> element with url + globalProps set
 * BEFORE it's connected to the DOM.
 *
 * Why: web-core's LynxView#render() is gated on `!#rendering && #connected`.
 * If connectedCallback fires while `#url` is undefined, render() sets
 * `#rendering = true` and kicks off a queueMicrotask whose only path that
 * resets `#rendering` lives inside `if (this.#url)`. With no url, the task
 * no-ops and `#rendering` stays `true` forever, so a *subsequent* `.url = x`
 * assignment triggers another render() call that immediately bails on the
 * `!#rendering` guard. Result: the first story visit is blank.
 *
 * Setting `url` via setAttribute before append populates `#url` through
 * attributeChangedCallback, so when connectedCallback runs it sees a
 * truthy url and the microtask actually loads the bundle.
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

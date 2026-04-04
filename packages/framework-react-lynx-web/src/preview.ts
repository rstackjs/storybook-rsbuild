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

// Subscribe to rspeedy rebuild events via SSE (server relays rspeedy's
// WebSocket). The Lynx web runtime can't apply CSS hot-updates inside the
// shadow DOM, so we reload the <lynx-view> to pick up the new styles.
// Note: we must use a cache-busting URL instead of reload() because
// @lynx-js/web-core's loadTemplate.js caches templates by URL string.
// reload() reuses the same URL and would serve the stale cached template.
// Only connect to the HMR endpoint during development.
// In production builds there is no /__lynx_hmr__ handler, so EventSource
// would reconnect endlessly generating noise in the network tab.
// Rsbuild replaces process.env.NODE_ENV at build time, so the entire
// block is removed via dead-code elimination in production bundles.
if (process.env.NODE_ENV !== 'production') {
  try {
    const es = new EventSource('/__lynx_hmr__')
    es.addEventListener('message', (e) => {
      if (e.data !== 'content-changed') return
      const lynxView = document.querySelector(
        'lynx-view',
      ) as LynxViewElement | null
      if (!lynxView?.url) return
      const baseUrl = lynxView.url.split('?')[0]
      lynxView.url = `${baseUrl}?t=${Date.now()}`
    })
  } catch {
    /* SSE not available, ignore */
  }
}

/**
 * Create a fresh <lynx-view> element with initial globalProps.
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

  // Set globalProps via both property and attribute before the element connects.
  // The attribute triggers attributeChangedCallback which writes to #globalProps,
  // and the property setter also writes to #globalProps directly.
  lynxView.setAttribute('global-props', JSON.stringify(globalProps))
  lynxView.globalProps = globalProps

  // Defer url assignment: <lynx-view>#render() internally uses queueMicrotask
  // after connectedCallback. On initial page load, Storybook may call
  // renderToCanvas multiple times, each time clearing innerHTML (disconnecting
  // the element). By deferring to setTimeout, we ensure the element is in its
  // final connected state before triggering the render.
  setTimeout(() => {
    if (lynxView.isConnected && !lynxView.url) {
      lynxView.url = lynxUrl
    }
  }, 50)

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

  // Fresh render: clear canvas and mount the new element.
  canvasElement.innerHTML = ''
  const element = storyFn()
  if (element instanceof Node) {
    canvasElement.appendChild(element)
    simulateDOMContentLoaded()
  }
}

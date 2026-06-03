// Side-effect-only preview entry: registers the <lynx-view> custom element and
// the full @lynx-js/web-elements set, and lets the builder inject their
// stylesheets.
//
// This file becomes an async module because `@lynx-js/web-core` ships with
// top-level await (WASM init). That's why the render/renderToCanvas exports
// live in the sibling `./preview.ts` instead of here — see the long note at
// the top of that file. Keeping the two responsibilities in separate entries
// lets the sync preview contribute exports to Storybook's composeConfigs
// while this async entry runs its side effects independently.

// `@lynx-js/web-core/client` is the canonical v0.21 web host entry (the same
// one lynx-stack's web-explorer imports): it registers <lynx-view>, applies
// the runtime's shadow-DOM styles (`css/in_shadow.css`) internally, and
// imports its head-level layout stylesheet (`css/index.css`) as a normal CSS
// import — which Storybook's rsbuild builder injects for us. No manual
// stylesheet plumbing is needed anymore (the old build exposed the CSS as a
// separate file we had to inject by hand; v0.21 bundles it through the JS).
import '@lynx-js/web-core/client'
// The web-elements main entry only ships shared utilities; `/all` is what
// actually registers x-view / x-text / x-image / … as custom elements.
import '@lynx-js/web-elements/all'

// Storybook-level sizing for <lynx-view>.
//
// web-core's own stylesheet sizes the element by its container and toggles
// its `display` when the runtime renders, so we only set dimensions here —
// never `display`, which web-core owns.
//
// Why viewport units instead of `width/height: 100%`: inside a Storybook
// `fullscreen` iframe the parent chain (`html`/`body`/`#storybook-root`) has
// no explicit height, so percentage heights collapse to 0 and the story
// renders blank even though the Lynx runtime booted. `100vh`/`100vw` anchor to
// the iframe's own viewport (the preview canvas), matching the canonical host
// pattern in lynx-stack web-explorer (`flex: 0 1 100vh; height: 100vh`). Users
// who want a centered/padded layout can override `parameters.layout` and this
// rule with their own CSS at higher specificity or a custom `render`.
const sbLynxViewStyle = document.createElement('style')
sbLynxViewStyle.textContent = 'lynx-view { width: 100vw; height: 100vh; }'
document.head.appendChild(sbLynxViewStyle)

/** Injected by `preset.ts`'s `source.define`: `true` in dev, `false` in a
 * production `storybook build`. */
declare const __LYNX_DEV__: boolean

/**
 * Reload the preview iframe when the user's lynx `.web.bundle` rebuilds.
 *
 * The `web` target has no React Fast-Refresh, and the rspeedy HMR client that
 * rsbuild embeds in the bundle runs inside web-core's background Worker — where
 * `location` has no `reload`, so it cannot reload the host iframe itself (it
 * logs `Cannot read properties of undefined (reading 'reload')` and gives up).
 * Story-file edits are served by Storybook's own preview HMR as a soft update
 * (no reload); but a COMPONENT source edit only rebuilds the lynx bundle, which
 * has to be re-fetched through web-core to take effect.
 *
 * So we open a second, read-only client on the SAME mounted `/lynx-hmr` socket
 * (see `experimental_devServer` / `createMountConfigPlugin` in preset.ts) from
 * the MAIN thread and reload when the lynx compilation hash changes. rsbuild's
 * HMR socket sends `{ type: 'hash', data }` on every completed build; reloading
 * only on a CHANGED hash means a story edit (which does not rebuild the lynx
 * bundle, so its hash is unchanged) never triggers a reload and Storybook's
 * soft story HMR stays intact. No proxy and no SSE server — just a listener on
 * the already-mounted socket, which is why this is not the reverse-proxy/SSE
 * bridge the mount design replaced.
 *
 * rsbuild guards `/lynx-hmr` with a per-environment `webSocketToken` (a
 * tokenless upgrade is `socket.destroy()`-ed), so we fetch the token the mount
 * exposes at `/__lynx_sb_hmr_token__` and pass it as `?token=` — re-fetched on
 * each connection attempt so an early/transient empty value self-heals.
 */
const LYNX_HMR_PATH = '/lynx-hmr'
const LYNX_HMR_TOKEN_PATH = '/__lynx_sb_hmr_token__'

async function connectLynxLiveReload(): Promise<void> {
  if (typeof window === 'undefined' || typeof WebSocket === 'undefined') return
  const { protocol, host } = window.location
  const wsProtocol = protocol === 'https:' ? 'wss' : 'ws'
  let lastHash: string | undefined
  let everOpened = false
  let backoff = 1000

  const open = async (): Promise<void> => {
    // Fetch the token on EVERY attempt: the mount captures it during the first
    // compile, so an early/transient empty value self-heals on retry instead
    // of being baked into the URL for the life of the page.
    let token = ''
    try {
      const res = await fetch(LYNX_HMR_TOKEN_PATH, { cache: 'no-store' })
      if (res.ok) token = (await res.text()).trim()
    } catch {
      // No token endpoint (not under the mount). We still try the socket; a
      // tokenless connection is refused and the backoff below caps the noise.
    }
    const query = token ? `?token=${encodeURIComponent(token)}` : ''
    const socket = new WebSocket(
      `${wsProtocol}://${host}${LYNX_HMR_PATH}${query}`,
    )

    socket.addEventListener('open', () => {
      everOpened = true
      backoff = 1000
    })
    socket.addEventListener('message', (event) => {
      let msg: { type?: string; data?: unknown }
      try {
        msg = JSON.parse(String(event.data))
      } catch {
        return
      }
      if (msg.type !== 'hash' || typeof msg.data !== 'string') return
      // First hash on (re)connect just establishes the baseline; rsbuild emits
      // `hash` after assets are written, so reloading on a changed one always
      // re-fetches the new bundle.
      if (lastHash !== undefined && msg.data !== lastHash) {
        window.location.reload()
        return
      }
      lastHash = msg.data
    })
    socket.addEventListener('close', () => {
      // Reconnect, but distinguish the two failure modes so a permanent
      // refusal (not under the mount, or a wrong token) doesn't spin a 1 Hz
      // reconnect/console-noise loop: retry promptly after a connection that
      // actually opened (a real dev-server restart), and back off up to 30s
      // when we've never managed to open. The timer is moot once we reload.
      const delay = everOpened ? 1000 : backoff
      if (!everOpened) backoff = Math.min(backoff * 2, 30000)
      window.setTimeout(() => void open(), delay)
    })
  }

  void open()
}

if (__LYNX_DEV__) {
  void connectLynxLiveReload()
}

// Side-effect-only preview entry: registers the <lynx-view> custom element
// (from `@lynx-js/web-core`), pulls in the full `@lynx-js/web-elements`
// element set, and injects the upstream layout stylesheets into
// document.head so <lynx-view>'s shadow DOM can mirror them via
// inject-head-links.
//
// This file becomes an async module because `@lynx-js/web-core` ships with
// top-level await (WASM init). That's why the render/renderToCanvas exports
// live in the sibling `./preview.ts` instead of here — see the long note at
// the top of that file. Keeping the two responsibilities in separate entries
// lets the sync preview contribute exports to Storybook's composeConfigs
// while this async entry runs its side effects independently.

// @ts-expect-error -- same, for @lynx-js/web-core's own layout rules
import webCoreCSS from '@lynx-js/web-core/index.css?inline'
// @ts-expect-error -- ?inline import resolves CSS to a string at build time
import webElementsCSS from '@lynx-js/web-elements/index.css?inline'
import '@lynx-js/web-core'
import '@lynx-js/web-elements/all'

// Inject both upstream stylesheets. `@lynx-js/web-core/index.css` provides
// the canonical `lynx-view { display: flex }` + `lynx-view::part(page)`
// sizing rules; without it the custom element defaults to `display: inline`
// (Web standard for unknown elements), which renders the shadow DOM
// invisible. The JS-side `import '@lynx-js/web-core'` does NOT pull in
// this CSS — in lynx-examples it is usually included via a separate
// `<link rel="stylesheet" href="@lynx-js/web-core/client.css">` in the
// host HTML, which we can't do here because Storybook owns iframe.html.
for (const css of [webElementsCSS, webCoreCSS]) {
  const link = document.createElement('link')
  link.rel = 'stylesheet'
  link.href = URL.createObjectURL(new Blob([css], { type: 'text/css' }))
  document.head.appendChild(link)
}

// Storybook-level sizing for <lynx-view>.
//
// Why viewport units instead of `width/height: 100%`:
//   `@lynx-js/web-core/index.css` gives <lynx-view> `contain: strict;
//   display: flex;` but no intrinsic size — the element collapses to 0×0
//   unless the host sets explicit dimensions. The obvious
//   `width: 100%; height: 100%` chain *doesn't* work inside a Storybook
//   preview iframe: the `fullscreen` layout only styles body with
//   `display: block`, and neither `html` nor `body` nor `#storybook-root`
//   gets `height: 100%`, so percentage heights collapse to 0 (the bug
//   showed up as a completely blank story even though the Lynx runtime
//   had booted and populated the shadow DOM).
//
// `100vh` / `100vw` anchor to the iframe's own viewport, which IS the
// preview canvas, bypassing the parent-chain problem entirely. This
// matches the canonical host pattern in lynx-stack
// `packages/web-platform/web-explorer/index.html` (`<lynx-view style="
// flex: 0 1 100vh; height: 100vh">`).
//
// Paired with `parameters.layout = 'fullscreen'` (framework default set
// in ./preview.ts) the element fills the canvas without any inline
// style on the element itself. Users who want a centered/padded layout
// can override both `parameters.layout` and this rule with their own CSS
// at higher specificity or a custom `render` function.
const sbLynxViewStyle = document.createElement('style')
sbLynxViewStyle.textContent = 'lynx-view { width: 100vw; height: 100vh; }'
document.head.appendChild(sbLynxViewStyle)

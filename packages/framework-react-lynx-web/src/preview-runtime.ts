// Side-effect-only preview entry: registers the <lynx-view> custom element
// (from `@lynx-js/web-core`), pulls in the full `@lynx-js/web-elements`
// element set, and injects web-elements' layout CSS into document.head so
// <lynx-view>'s shadow DOM can mirror it via inject-head-links.
//
// This file becomes an async module because `@lynx-js/web-core` ships with
// top-level await (WASM init). That's why the render/renderToCanvas exports
// live in the sibling `./preview.ts` instead of here — see the long note at
// the top of that file. Keeping the two responsibilities in separate entries
// lets the sync preview contribute exports to Storybook's composeConfigs
// while this async entry runs its side effects independently.

// @ts-expect-error -- ?inline import resolves CSS to a string at build time
import webElementsCSS from '@lynx-js/web-elements/index.css?inline'
import '@lynx-js/web-core'
import '@lynx-js/web-elements/all'

const webElementsLink = document.createElement('link')
webElementsLink.rel = 'stylesheet'
webElementsLink.href = URL.createObjectURL(
  new Blob([webElementsCSS], { type: 'text/css' }),
)
document.head.appendChild(webElementsLink)

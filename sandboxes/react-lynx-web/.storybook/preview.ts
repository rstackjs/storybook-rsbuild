// Register <lynx-view> custom element and web elements.
// These side-effect imports must be in the user's preview.ts (not the
// framework's preview.ts) because bundling them into the framework
// preview chunk causes Storybook to lose the custom render/renderToCanvas exports.
import '@lynx-js/web-core'
import '@lynx-js/web-elements/all'

export const parameters = {
  controls: {
    matchers: {
      color: /(background|color)$/i,
      date: /Date$/i,
    },
  },
}

// Port: @storybook/nextjs/src/image-context.ts
/**
 * Single React context that carries per-story `parameters.nextjs.image` from the
 * `ImageDecorator` to the `next/image` mock. Both the decorator (bundled into
 * `preview`) and the mock (shipped uncompiled, aliased over `next/image`) import
 * it via `storybook-next-rsbuild/image-context`, so they share ONE context
 * identity — the decorator provides, the mock consumes.
 *
 * Ships uncompiled for the same reason as the other `loaders/*` shims: it must
 * resolve `react` from the user's project (Storybook's singleton React), not
 * ours. Bundling it into `preview` would inline a second copy and the mock's
 * `useContext` would read an empty, never-provided context (the failure mode of
 * routing the value through Next's internal `ImageConfigContext` instead).
 */
const React = require('react')

module.exports = { ImageContext: React.createContext({}) }

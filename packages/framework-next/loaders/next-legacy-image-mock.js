// Adapted from @storybook/nextjs/src/images/next-legacy-image.tsx
/**
 * Mock `next/legacy/image` with a loader that serves images directly —
 * Storybook has no `/_next/image` optimization endpoint. Ships uncompiled;
 * resolves `next` from the user's project (aliased from `next/legacy/image` in
 * preset.ts). Imports the component from `next/dist/client/legacy/image`
 * directly: importing `'next/legacy/image'` would self-recurse through the
 * exact-match alias preset.ts installs.
 * nextjs-vite has no direct equivalent — its Vite plugin integrates differently.
 */
'use client'

import * as _NextLegacyImage from 'next/dist/client/legacy/image'
import * as React from 'react'
// Per-story `parameters.nextjs.image`, provided by ImageDecorator. Same module
// identity as the decorator's import (both go through the package's
// `./image-context` export), so `useContext` actually reads the provided value.
import { ImageContext } from 'storybook-next-rsbuild/image-context'
import { makeDefaultLoader } from './next-image-default-loader.js'

// Handle CJS/ESM interop — Rspack may double-wrap the default export
const OriginalLegacyImage =
  _NextLegacyImage.default?.default ?? _NextLegacyImage.default

const defaultLoader = makeDefaultLoader('next/legacy/image')

const MockedNextLegacyImage = React.forwardRef(function NextLegacyImage(
  { loader, ...props },
  ref,
) {
  const imageParameters = React.useContext(ImageContext)

  return React.createElement(OriginalLegacyImage, {
    ref,
    ...imageParameters,
    ...props,
    // Deliberate divergence from the upstream port: honor a per-story
    // `parameters.nextjs.image.loader` (documented in the parameters table)
    // before falling back to the framework default. Upstream skips straight
    // to its default loader here.
    loader: loader ?? imageParameters?.loader ?? defaultLoader,
  })
})

export default MockedNextLegacyImage

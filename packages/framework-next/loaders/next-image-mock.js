// Port: @storybook/nextjs/src/images/next-image.tsx
/**
 * Mock `next/image` with a loader that serves images directly — Storybook has
 * no `/_next/image` optimization endpoint. Ships uncompiled; resolves `next`
 * from the user's project (aliased from `next/image` in preset.ts).
 * nextjs-vite has no direct equivalent — its Vite plugin integrates differently.
 */
'use client'

import * as React from 'react'
import * as _NextImage from 'sb-original/next/image'
// Per-story `parameters.nextjs.image`, provided by ImageDecorator. Same module
// identity as the decorator's import (both go through the package's
// `./image-context` export), so `useContext` actually reads the provided value.
import { ImageContext } from 'storybook-next-rsbuild/image-context'
import { makeDefaultLoader } from './next-image-default-loader.js'

// Handle CJS/ESM interop — Rspack may double-wrap the default export
const OriginalImage = _NextImage.default?.default ?? _NextImage.default

const defaultLoader = makeDefaultLoader('next/image')

const MockedNextImage = React.forwardRef(function NextImage(
  { loader, ...props },
  ref,
) {
  const imageParameters = React.useContext(ImageContext)

  return React.createElement(OriginalImage, {
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

export default MockedNextImage
// Inject the passthrough loader so `getImageProps()` builds servable URLs
// instead of pointing srcSet at the absent `/_next/image` endpoint.
export const getImageProps = (props) =>
  _NextImage.getImageProps?.({ loader: defaultLoader, ...props })

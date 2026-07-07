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

// Handle CJS/ESM interop — Rspack may double-wrap the default export
const OriginalLegacyImage =
  _NextLegacyImage.default?.default ?? _NextLegacyImage.default

function defaultLoader({ src, width, quality = 75 }) {
  // Mirror @storybook/nextjs: fail with an actionable message instead of an
  // opaque `width.toString()` TypeError if a caller omits src/width.
  const missingValues = []
  if (!src) missingValues.push('src')
  if (!width) missingValues.push('width')
  if (missingValues.length > 0) {
    throw new Error(
      `Next Image Optimization requires ${missingValues.join(', ')} to be provided. ` +
        'Make sure you pass them as props to the `next/legacy/image` component. ' +
        `Received: ${JSON.stringify({ src, width, quality })}`,
    )
  }

  const url = new URL(src, globalThis.location?.href)
  if (!url.searchParams.has('w') && !url.searchParams.has('q')) {
    url.searchParams.set('w', width.toString())
    url.searchParams.set('q', quality.toString())
  }
  if (!src.startsWith('http://') && !src.startsWith('https://')) {
    return url.toString().slice(url.origin.length)
  }
  return url.toString()
}

const MockedNextLegacyImage = React.forwardRef(function NextLegacyImage(
  { loader, ...props },
  ref,
) {
  const imageParameters = React.useContext(ImageContext)

  return React.createElement(OriginalLegacyImage, {
    ref,
    ...imageParameters,
    ...props,
    loader: loader ?? defaultLoader,
  })
})

export default MockedNextLegacyImage

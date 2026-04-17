// Port: @storybook/nextjs/src/images/next-image.tsx
// Port: @storybook/nextjs/src/images/next-image-default-loader.tsx
/**
 * Mock `next/image` with a loader that serves images directly — Storybook has
 * no `/_next/image` optimization endpoint. Ships uncompiled; resolves `next`
 * from the user's project (aliased from `next/image` in preset.ts).
 * nextjs-vite has no direct equivalent — its Vite plugin integrates differently.
 */
'use client'

import * as _NextImage from 'next/dist/shared/lib/image-external'
import * as React from 'react'

// Handle CJS/ESM interop — Rspack may double-wrap the default export
const OriginalImage = _NextImage.default?.default ?? _NextImage.default

function defaultLoader({ src, width, quality = 75 }) {
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

const MockedNextImage = React.forwardRef(function NextImage(
  { loader, ...props },
  ref,
) {
  return React.createElement(OriginalImage, {
    ref,
    ...props,
    loader: loader ?? defaultLoader,
  })
})

export default MockedNextImage
export const getImageProps = _NextImage.getImageProps

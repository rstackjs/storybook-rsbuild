/**
 * Mock for `next/image` that replaces the default loader.
 *
 * In a real Next.js app, images go through the /_next/image optimization
 * endpoint. Storybook doesn't have that endpoint, so we swap in a loader
 * that serves images directly with width/quality query params.
 *
 * This file is intentionally plain JS and ships uncompiled — it runs inside
 * the user's Storybook Rsbuild build (aliased from `next/image`) and must
 * resolve `next` from the user's project, not from our package.
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

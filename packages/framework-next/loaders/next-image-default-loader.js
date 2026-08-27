// Port: @storybook/nextjs/src/images/next-image-default-loader.tsx
/**
 * Passthrough image loader shared by the `next/image` and `next/legacy/image`
 * mocks. Storybook has no `/_next/image` optimization endpoint, so this serves
 * the source URL directly (appending `w`/`q` params) instead of routing through
 * the absent optimizer. Ships uncompiled alongside the mocks that import it;
 * `componentName` only tailors the actionable error message.
 */
export function makeDefaultLoader(componentName) {
  return function defaultLoader({ src, width, quality = 75 }) {
    // Mirror @storybook/nextjs: fail with an actionable message instead of an
    // opaque `width.toString()` TypeError if a caller omits src/width.
    const missingValues = []
    if (!src) missingValues.push('src')
    if (!width) missingValues.push('width')
    if (missingValues.length > 0) {
      throw new Error(
        `Next Image Optimization requires ${missingValues.join(', ')} to be provided. ` +
          `Make sure you pass them as props to the \`${componentName}\` component. ` +
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
}

// Adapted from @storybook/nextjs/src/next-image-loader-stub.ts
/**
 * Resolves static image imports (`import img from './x.png'`) to a
 * `StaticImageData` object (`{ src, height, width, blurDataURL }`) matching
 * upstream `@storybook/nextjs`, instead of Rsbuild's default bare-URL string.
 * Ships uncompiled; resolves `next` from the user's project, so the image-size
 * and loader-utils helpers come from the same `next` the bridge extracts.
 *
 * Dimension probing + filename interpolation reuse Next.js's own compiled
 * copies (`next/dist/compiled/image-size`, `.../loader-utils3`) so we add no new
 * dependency.
 */
const { imageSize } = require('next/dist/compiled/image-size')
const { interpolateName } = require('next/dist/compiled/loader-utils3')

const nextImageLoaderStub = function NextImageLoader(content) {
  const { filename, disableStaticImages } = this.getOptions()
  const opts = { context: this.rootContext, content }
  const outputPath = interpolateName(
    this,
    filename.replace('[ext]', '.[ext]'),
    opts,
  )

  this.emitFile(outputPath, content)

  if (disableStaticImages) {
    return `const src = '${outputPath}'; export default src;`
  }

  const { width, height } = imageSize(content)

  return `export default ${JSON.stringify({
    src: outputPath,
    height,
    width,
    blurDataURL: outputPath,
  })};`
}

nextImageLoaderStub.raw = true

module.exports = nextImageLoaderStub
module.exports.raw = true

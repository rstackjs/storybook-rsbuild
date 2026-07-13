/**
 * Wraps next-swc-loader but omits the `pitch` export — next-swc-loader's pitch
 * reads source files from disk, which fails for Storybook's virtual modules
 * (storybook-config-entry.js, etc.) that only exist in memory.
 *
 * We forward `raw` (next-swc-loader sets `export const raw = true`) so
 * loader-runner feeds the module Buffer as-is, but deliberately leave `pitch`
 * undefined — dropping the pitch phase is the whole purpose of this shim.
 * Ships uncompiled — resolves `next` from the user's project.
 */
const nextSwcLoader = require('next/dist/build/webpack/loaders/next-swc-loader')
const impl = nextSwcLoader.default || nextSwcLoader

module.exports = function swcLoaderShim(...args) {
  return impl.apply(this, args)
}

module.exports.raw = nextSwcLoader.raw

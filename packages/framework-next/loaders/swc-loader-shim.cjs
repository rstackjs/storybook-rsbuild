/**
 * Wraps next-swc-loader but omits the `pitch` export — next-swc-loader's pitch
 * reads source files from disk, which fails for Storybook's virtual modules
 * (storybook-config-entry.js, etc.) that only exist in memory.
 * Ships uncompiled — resolves `next` from the user's project.
 */
const nextSwcLoader = require('next/dist/build/webpack/loaders/next-swc-loader')

module.exports = nextSwcLoader.default || nextSwcLoader

/**
 * Thin wrapper around next-swc-loader that strips the `pitch` function.
 *
 * next-swc-loader's pitch reads source files from disk, which fails for
 * Storybook's virtual modules (storybook-config-entry.js, etc.) that only
 * exist in memory via VirtualModulesPlugin.
 *
 * This file ships uncompiled — it resolves `next` from the user's project.
 */
const nextSwcLoader = require('next/dist/build/webpack/loaders/next-swc-loader')

module.exports = nextSwcLoader.default || nextSwcLoader
// Intentionally no module.exports.pitch — that's the whole point of this shim

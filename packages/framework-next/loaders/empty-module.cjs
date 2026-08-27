// Empty-module shim. `StripNodeProtocolPlugin` (src/preset.ts) rewrites
// `node:`-only specifiers that have no bare-builtin counterpart (e.g.
// `node:sqlite`, `node:test`) to this module so a dead, server-only import in a
// browser bundle resolves to an empty module instead of failing the build.
module.exports = {}

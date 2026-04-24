/**
 * Rewrites `/_next/static/media/` → `/static/media/` in CSS emitted by
 * `next-font-loader` (Next.js hardcodes the `/_next/` prefix, but emits
 * binaries at `static/media/` and relies on a dev-server alias we don't have).
 * Strips `meta.ast` so css-loader re-parses our rewritten string instead of
 * reusing the stale postcss AST from next-font-loader.
 */
module.exports = function (source, sourceMap, meta) {
  const rewritten =
    typeof source === 'string'
      ? source.replaceAll('/_next/static/media/', '/static/media/')
      : source
  const { ast: _unused, ...restMeta } = meta || {}
  this.callback(null, rewritten, sourceMap, restMeta)
}

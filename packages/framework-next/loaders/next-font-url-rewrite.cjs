/**
 * Rewrites `/_next/static/media/` → `/static/media/` in CSS emitted by
 * `next-font-loader`.
 *
 * Next.js hardcodes the `/_next/` prefix in url() references (see
 * next-font-loader/index.js:78) but `emitFile` writes font binaries at
 * `static/media/[hash]`, relying on its dev server to alias `/_next/` →
 * output root. Storybook has no such alias, so without this rewrite the
 * browser 404s every font file.
 *
 * Placed immediately before `next-font-loader` in the `use` chain so it
 * runs *after* it in execution order (loaders apply right-to-left).
 *
 * Strips `meta.ast` so that downstream `css-loader` re-parses our rewritten
 * source string. Without that, css-loader (src/index.js:227-229) prefers the
 * postcss AST already built by next-font-loader and our text edit is ignored.
 * `meta.exports` / `meta.fontFamilyHash` are forwarded untouched.
 */
module.exports = function (source, sourceMap, meta) {
  const rewritten =
    typeof source === 'string'
      ? source.replaceAll('/_next/static/media/', '/static/media/')
      : source
  const { ast: _unused, ...restMeta } = meta || {}
  this.callback(null, rewritten, sourceMap, restMeta)
}

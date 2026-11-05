/**
 * Renders a peer dependency range exactly as declared in the package manifests
 * under `packages/`. The ranges are read at config time in `rstack.config.ts`
 * and injected via Rsbuild `source.define`, so docs never drift from what is
 * published.
 *
 * Set `cell` when rendering inside a table cell: GFM splits cells on `|` even
 * inside code spans, so the `.md` / llms.txt build (Rspress sets `__SSR_MD__`
 * for its `node_md` environment) must escape the `||` of a union such as
 * `^18.0.0 || ^19.0.0`. Outside a table that backslash would be literal.
 */
export const PeerRange = ({
  name,
  cell = false,
}: {
  name: keyof typeof __PEER_RANGES__
  cell?: boolean
}) => {
  const range = __PEER_RANGES__[name]
  return (
    <code>
      {cell && process.env.__SSR_MD__ ? range.split('|').join('\\|') : range}
    </code>
  )
}

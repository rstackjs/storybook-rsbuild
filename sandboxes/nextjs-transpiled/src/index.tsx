// Untranspiled TSX source: only compiles when Next.js's `transpilePackages`
// pulls this workspace package through the SWC pipeline. Without it, rspack
// hits an unparseable JSX token and the sandbox build fails.
export const TranspiledBadge = ({ label }: { label: string }) => (
  <span
    data-testid="transpiled-badge"
    style={{ padding: '4px 8px', background: '#0f0', color: '#000' }}
  >
    {label}
  </span>
)

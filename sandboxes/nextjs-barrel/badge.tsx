export const Badge = ({ children }: { children: string }) => (
  <span
    data-testid="barrel-ts-badge"
    style={{ padding: '2px 6px', background: '#ff4785', color: '#fff' }}
  >
    {children}
  </span>
)

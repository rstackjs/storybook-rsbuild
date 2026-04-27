'use client'

export default function LazyComponent() {
  return (
    <div
      data-testid="dynamic-loaded"
      style={{ padding: 8, background: '#eef' }}
    >
      Lazy chunk loaded
    </div>
  )
}

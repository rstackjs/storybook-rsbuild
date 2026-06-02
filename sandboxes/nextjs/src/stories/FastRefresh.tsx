'use client'
import { useState } from 'react'

// Fixture for the Fast Refresh e2e: the spec flips the marker text below and
// asserts the counter state survives the hot update (Fast Refresh, not reload).
export function FastRefresh() {
  const [count, setCount] = useState(0)
  return (
    <div>
      <p data-testid="fr-marker">FR_MARKER_V1</p>
      <p>
        count: <span data-testid="fr-count">{count}</span>
      </p>
      <button
        type="button"
        data-testid="fr-inc"
        onClick={() => setCount((c) => c + 1)}
      >
        inc
      </button>
    </div>
  )
}

'use client'

import { useState } from 'react'

export const Counter = () => {
  const [count, setCount] = useState(0)

  return (
    <div style={{ fontFamily: 'sans-serif', padding: 20 }}>
      <h2>Counter: {count}</h2>
      <button type="button" onClick={() => setCount((c) => c + 1)}>
        +1
      </button>
      <button type="button" onClick={() => setCount((c) => c - 1)}>
        -1
      </button>
      <p style={{ color: '#888', marginTop: 12 }}>
        Edit this file and check whether the count resets.
      </p>
    </div>
  )
}

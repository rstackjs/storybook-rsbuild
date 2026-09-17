import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { CounterButton } from './components/counter-button'

function App() {
  const [count, setCount] = useState(0)

  return (
    <CounterButton
      label={`Count: ${count}`}
      onClick={() => setCount((value) => value + 1)}
    />
  )
}

createRoot(document.getElementById('root')!).render(<App />)

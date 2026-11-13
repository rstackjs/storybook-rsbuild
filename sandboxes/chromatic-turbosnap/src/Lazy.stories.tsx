import { lazy, Suspense } from 'react'

// Dynamic import: HeavyPanel is emitted as a separate chunk.
const HeavyPanel = lazy(() => import('./HeavyPanel'))

const LazyPanel = ({ label }: { label: string }) => (
  <Suspense fallback="loading">
    <HeavyPanel label={label} />
  </Suspense>
)

export default { component: LazyPanel }

export const Default = { args: { label: 'Lazy' } }

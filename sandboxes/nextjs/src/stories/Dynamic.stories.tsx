import dynamic from 'next/dynamic'
import type { Meta, StoryObj } from 'storybook-next-rsbuild'

// Regression target: next/dynamic chunk-splitting + loading placeholder path.
// If our cherry-pick of Next.js's rules drops the dynamic-import handler,
// the lazy chunk never resolves and the placeholder never swaps out.
const LazyComponent = dynamic(() => import('./LazyComponent'), {
  loading: () => <p data-testid="dynamic-loading">Loading lazy chunk…</p>,
  ssr: false,
})

function DynamicProbe() {
  return (
    <div>
      <h3>next/dynamic probe</h3>
      <LazyComponent />
    </div>
  )
}

const meta = { component: DynamicProbe } satisfies Meta<typeof DynamicProbe>

export default meta

export const Default: StoryObj<typeof meta> = {}

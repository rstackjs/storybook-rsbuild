import './tailwind.css'
import type { Meta, StoryObj } from 'storybook-next-rsbuild'

// Regression target: `@tailwind utilities` must be expanded by Rsbuild's
// PostCSS pipeline (the most common feature across the gauntlet projects).
function TailwindProbe() {
  return (
    <div className="font-bold text-[rgb(255,71,133)]" data-testid="tw-probe">
      tailwind
    </div>
  )
}

const meta = { component: TailwindProbe } satisfies Meta<typeof TailwindProbe>

export default meta

export const Default: StoryObj<typeof meta> = {}

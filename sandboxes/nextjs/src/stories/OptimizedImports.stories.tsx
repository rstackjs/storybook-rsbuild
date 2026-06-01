import { Badge } from '@sandboxes/nextjs-barrel'
import { Heart, Star } from 'lucide-react'
import type { Meta, StoryObj } from 'storybook-next-rsbuild'

// Regression target: `optimizePackageImports` rewrites these named imports to
// `__barrel_optimize__?names=Heart,Star!=!lucide-react` specifiers. lucide-react
// ships JS; the `TsBarrel` story below adds a TS re-export barrel whose
// matchResource points at TS source (the case that broke safe-wallet's @mui).
function OptimizedImportsProbe() {
  return (
    <div
      data-testid="optimized-imports-probe"
      style={{ display: 'flex', gap: 8 }}
    >
      <Heart data-testid="icon-heart" size={32} color="rgb(255, 71, 133)" />
      <Star data-testid="icon-star" size={32} color="rgb(255, 199, 0)" />
    </div>
  )
}

const meta = {
  component: OptimizedImportsProbe,
} satisfies Meta<typeof OptimizedImportsProbe>

export default meta

export const Default: StoryObj<typeof meta> = {}

export const TsBarrel: StoryObj<typeof meta> = {
  render: () => <Badge>ok</Badge>,
}

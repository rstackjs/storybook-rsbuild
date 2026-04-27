import { Heart, Star } from 'lucide-react'
import type { Meta, StoryObj } from 'storybook-next-rsbuild'

// Regression target: `optimizePackageImports` rewrites these named imports to
// `__barrel_optimize__?names=Heart,Star!=!lucide-react` specifiers, which
// flow through Next.js's barrel rule. Two failure modes guarded:
//   - oneOf filter regresses to letting the JS branch through → dev mode
//     crashes with duplicate `$RefreshSig$` declarations.
//   - barrel test narrowed too aggressively → `__barrel_optimize__?…!=!…`
//     has no handler, build errors with "Module parse failed".
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

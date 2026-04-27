import './globals.css'
import type { Meta, StoryObj } from 'storybook-next-rsbuild'

// Regression target: Next.js's global CSS rule survives `prepareNextCssRules`
// extraction. If Rsbuild's CSS pipeline isn't fully replaced, global imports
// either error at build (Next.js error-loader fires for non-_app issuers) or
// silently drop styles.
function GlobalCssProbe() {
  return (
    <p className="sb-global-probe" data-testid="global-css-probe">
      Global CSS class applied
    </p>
  )
}

const meta = { component: GlobalCssProbe } satisfies Meta<typeof GlobalCssProbe>

export default meta

export const Default: StoryObj<typeof meta> = {}

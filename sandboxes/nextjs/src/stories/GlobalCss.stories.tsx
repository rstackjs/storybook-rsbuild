import './globals.css'
import type { Meta, StoryObj } from 'storybook-next-rsbuild'

// Regression target: a global `.css` import from preview must apply its styles.
// Rsbuild owns plain CSS, so this guards that global imports aren't dropped.
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

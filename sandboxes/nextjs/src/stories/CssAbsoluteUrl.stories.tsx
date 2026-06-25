import './css-absolute-url.css'
import type { Meta, StoryObj } from 'storybook-next-rsbuild'

// Regression target: a root-absolute `url(/vercel.svg)` must build (css-loader
// passes it through as a runtime URL instead of resolving it as a module).
function AbsUrlProbe() {
  return <div className="sb-abs-url-probe" data-testid="css-abs-url-probe" />
}

const meta = { component: AbsUrlProbe } satisfies Meta<typeof AbsUrlProbe>

export default meta

export const Default: StoryObj<typeof meta> = {}

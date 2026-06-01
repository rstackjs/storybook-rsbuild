import './css-external-url.css'
import type { Meta, StoryObj } from 'storybook-next-rsbuild'

// Regression target: a `data:`/external `url()` must survive css-loader
// untouched as a runtime URL, not be resolved as a module.
function ExtUrlProbe() {
  return <div className="sb-ext-url-probe" data-testid="css-ext-url-probe" />
}

const meta = { component: ExtUrlProbe } satisfies Meta<typeof ExtUrlProbe>

export default meta

export const Default: StoryObj<typeof meta> = {}

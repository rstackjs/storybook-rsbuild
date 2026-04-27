import { TranspiledBadge } from '@sandboxes/nextjs-transpiled'
import type { Meta, StoryObj } from 'storybook-next-rsbuild'

// Regression target: Next.js's `transpilePackages: ['@sandboxes/nextjs-transpiled']`
// must reach our extracted rule set so the workspace package's untranspiled
// TSX source goes through next-swc-loader. Without it, rspack hits raw JSX
// and the build fails before runtime.
function TranspilePackagesProbe() {
  return (
    <div data-testid="transpile-packages-probe">
      <TranspiledBadge label="from workspace dep" />
    </div>
  )
}

const meta = {
  component: TranspilePackagesProbe,
} satisfies Meta<typeof TranspilePackagesProbe>

export default meta

export const Default: StoryObj<typeof meta> = {}

import type { Meta, StoryObj } from 'storybook-next-rsbuild'
import StarIcon from './star.svg'

// Verifies that user-side `next.config.webpack()` rules with bare loader
// specifiers (e.g. `@svgr/webpack`) resolve from the consumer's node_modules
// — i.e. the `resolveLoader.modules` fallback path in `preset.ts`. Also
// implicitly verifies the safe-wallet pattern of mutating the default
// image rule's `exclude` so SVGR is the one that processes .svg.
function SvgrIconStory() {
  const Icon = StarIcon as unknown as React.ComponentType<
    React.SVGProps<SVGSVGElement>
  >
  return (
    <div data-testid="svgr-host">
      <Icon data-testid="svgr-icon" width={48} height={48} />
    </div>
  )
}

const meta = {
  component: SvgrIconStory,
} satisfies Meta<typeof SvgrIconStory>

export default meta

type Story = StoryObj<typeof meta>

export const Default: Story = {}

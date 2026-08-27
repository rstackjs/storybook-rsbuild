// @ts-expect-error — module does not exist; mapped to empty via
// `resolve.fallback['sandbox-fake-native'] = false` in next.config.webpack().
// If the user-side fallback isn't forwarded, rspack errors at build time
// ("Can't resolve 'sandbox-fake-native'") and the story never reaches render.
import * as fake from 'sandbox-fake-native'
import type { Meta, StoryObj } from 'storybook-next-rsbuild'

function UserFallbackStory() {
  const keys = Object.keys(fake)
  return (
    <div data-testid="user-fallback-probe">
      sandbox-fake-native resolved to empty module ({keys.length} keys)
    </div>
  )
}

const meta = {
  component: UserFallbackStory,
} satisfies Meta<typeof UserFallbackStory>

export default meta

type Story = StoryObj<typeof meta>

export const Default: Story = {}

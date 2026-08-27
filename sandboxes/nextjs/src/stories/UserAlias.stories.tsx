// @ts-expect-error — alias is defined by next.config.webpack(), not in tsconfig.
import { UserAliasMessage } from '@user-alias/probe'
import type { Meta, StoryObj } from 'storybook-next-rsbuild'

// Verifies that `resolve.alias` added inside `next.config.webpack(config, opts)`
// flows through `userDelta.alias` and lands in rspack's resolver.
function UserAliasStory() {
  return <div data-testid="user-alias-probe">{UserAliasMessage}</div>
}

const meta = {
  component: UserAliasStory,
} satisfies Meta<typeof UserAliasStory>

export default meta

type Story = StoryObj<typeof meta>

export const Default: Story = {}

import type { Meta, StoryObj } from 'storybook-next-rsbuild'

declare const __USER_DEFINE__: string

function UserDefineStory() {
  return <div data-testid="user-define-probe">{__USER_DEFINE__}</div>
}

const meta = {
  component: UserDefineStory,
} satisfies Meta<typeof UserDefineStory>

export default meta

type Story = StoryObj<typeof meta>

export const Default: Story = {}

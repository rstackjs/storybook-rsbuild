import type { Meta, StoryObj } from 'storybook-react-lynx-web-rsbuild'

const meta = {
  title: 'Example/Card',
  parameters: {
    lynx: {
      component: 'Card',
    },
  },
  argTypes: {
    title: { control: 'text' },
    body: { control: 'text' },
  },
} satisfies Meta

export default meta
type Story = StoryObj

export const Default: Story = {
  args: {
    title: 'Hello',
    body: 'This is a card rendered inside Storybook',
  },
}

export const Warning: Story = {
  args: {
    title: 'Warning',
    body: 'Something needs your attention',
  },
}

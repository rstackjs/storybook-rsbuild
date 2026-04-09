import type { Meta, StoryObj } from 'storybook-react-lynx-web-rsbuild'

const meta = {
  title: 'Example/Button',
  parameters: {
    lynx: {
      component: 'Button',
    },
  },
  argTypes: {
    label: { control: 'text' },
    primary: { control: 'boolean' },
  },
} satisfies Meta

export default meta
type Story = StoryObj

export const Primary: Story = {
  args: {
    primary: true,
    label: 'Button',
  },
}

export const Secondary: Story = {
  args: {
    primary: false,
    label: 'Button',
  },
}

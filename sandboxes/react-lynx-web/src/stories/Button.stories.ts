import type { Meta, StoryObj } from '@storybook/web-components'

const meta = {
  title: 'Example/Button',
  parameters: {
    lynx: {
      // Points to the pre-built Lynx web bundle served via staticDirs
      url: '/lynx-bundles/Button.web.bundle',
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

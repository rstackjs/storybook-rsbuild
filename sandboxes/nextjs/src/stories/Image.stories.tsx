import Image from 'next/image'
import type { Meta, StoryObj } from 'storybook-next-rsbuild'

const meta = {
  component: Image,
  args: {
    src: '/vercel.svg',
    alt: 'Vercel Logo',
    width: 200,
    height: 48,
  },
} satisfies Meta<typeof Image>

export default meta

type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const FilledParent: Story = {
  args: {
    fill: true,
    width: undefined,
    height: undefined,
  },
  decorators: [
    (Story) => (
      <div style={{ width: 500, height: 500, position: 'relative' }}>
        <Story />
      </div>
    ),
  ],
}

export const WithRemoteImage: Story = {
  args: {
    src: 'https://storybook.js.org/images/placeholders/50x50.png',
    alt: 'Placeholder',
    width: 50,
    height: 50,
  },
}

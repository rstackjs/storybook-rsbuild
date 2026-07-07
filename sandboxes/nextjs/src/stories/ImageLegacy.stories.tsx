import Image from 'next/legacy/image'
import type { Meta, StoryObj } from 'storybook-next-rsbuild'
import nextjsPng from './assets/nextjs.png'

const meta = {
  component: Image,
  args: {
    src: nextjsPng,
    alt: 'Legacy Static',
    priority: true,
  },
} satisfies Meta<typeof Image>

export default meta

type Story = StoryObj<typeof meta>

export const Default: Story = {}

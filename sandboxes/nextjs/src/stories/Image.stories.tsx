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

// Tiny 1x1 transparent PNG, inline so the story is hermetic.
const BLUR_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='

// `src` is a remote URL the E2E test holds in a route handler so the blur
// layer stays painted during the assertion. The cached SVG used by other
// variants would clear it before Playwright could read the style attribute.
export const WithBlurPlaceholder: Story = {
  args: {
    src: 'https://storybook.js.org/blur-target.png',
    alt: 'Blur Probe',
    placeholder: 'blur',
    blurDataURL: BLUR_DATA_URL,
  },
}

export const WithPriorityAndSizes: Story = {
  args: {
    priority: true,
    sizes: '(max-width: 768px) 100vw, 50vw',
  },
}

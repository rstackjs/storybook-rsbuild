import Image from 'next/image'
import type { Meta, StoryObj } from 'storybook-next-rsbuild'
import nextjsPng from './assets/nextjs.png'

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

// `parameters.nextjs.image` is provided by ImageDecorator and read by the mock
// as default props (explicit args still win). Guards the decorator↔mock shared
// image-context wiring.
export const WithStoryParams: Story = {
  parameters: {
    nextjs: {
      image: {
        loading: 'eager',
      },
    },
  },
}

// Static import resolves to StaticImageData; intrinsic width/height (96x64)
// reach the <img> when args don't override them.
export const StaticImport: Story = {
  args: {
    src: nextjsPng,
    alt: 'Static Import',
    width: undefined,
    height: undefined,
  },
}

export const StaticBlurPlaceholder: Story = {
  args: {
    src: nextjsPng,
    alt: 'Static Blur',
    placeholder: 'blur',
    width: undefined,
    height: undefined,
  },
}

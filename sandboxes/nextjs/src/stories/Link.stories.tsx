import Link from 'next/link'
import type { Meta, StoryObj } from 'storybook-next-rsbuild'

const Component = () => (
  <ul>
    <li>
      <Link href="/">Normal Link</Link>
    </li>
    <li>
      <Link
        href={{
          pathname: '/with-url-object',
          query: { name: 'test' },
        }}
      >
        With URL Object
      </Link>
    </li>
    <li>
      <Link href="/replace-url" replace>
        Replace the URL instead of push
      </Link>
    </li>
    <li>
      <Link href="/#hashid" scroll={false}>
        Disables scrolling to the top
      </Link>
    </li>
    <li>
      <Link href="/no-prefetch" prefetch={false}>
        No Prefetching
      </Link>
    </li>
    <li>
      <Link style={{ color: 'red' }} href="/with-style">
        With style
      </Link>
    </li>
  </ul>
)

export default {
  component: Component,
} as Meta<typeof Component>

type Story = StoryObj<typeof Component>

export const Default: Story = {}

export const InAppDir: Story = {
  parameters: {
    nextjs: {
      appDirectory: true,
    },
  },
}

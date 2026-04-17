import Head from 'next/head'
import { expect, waitFor } from 'storybook/test'
import type { Meta, StoryObj } from 'storybook-next-rsbuild'

function Component() {
  return (
    <div>
      <Head>
        <title>Next.js Head Title</title>
        <meta property="og:title" content="My page title" key="title" />
      </Head>
      <Head>
        <meta property="og:title" content="My new title" key="title" />
      </Head>
      <p>Hello world!</p>
    </div>
  )
}

const meta = {
  component: Component,
} satisfies Meta<typeof Component>

export default meta

type Story = StoryObj<typeof meta>

export const Default: Story = {
  play: async () => {
    await waitFor(() => expect(document.title).toEqual('Next.js Head Title'))
  },
}

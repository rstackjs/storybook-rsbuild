import {
  useParams,
  usePathname,
  useRouter,
  useSearchParams,
  useSelectedLayoutSegment,
  useSelectedLayoutSegments,
} from 'next/navigation'
import { expect, userEvent, within } from 'storybook/test'
import type { Meta, StoryObj } from 'storybook-next-rsbuild'
import { getRouter } from 'storybook-next-rsbuild/navigation.mock'

function Component() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const params = useParams()
  const segment = useSelectedLayoutSegment()
  const segments = useSelectedLayoutSegments()

  const searchParamsList = searchParams
    ? Array.from(searchParams.entries())
    : []

  const routerActions = [
    { cb: () => router.back(), name: 'Go back' },
    { cb: () => router.forward(), name: 'Go forward' },
    { cb: () => router.prefetch('/prefetched-html'), name: 'Prefetch' },
    { cb: () => router.push('/push-html'), name: 'Push HTML' },
    { cb: () => router.refresh(), name: 'Refresh' },
    { cb: () => router.replace('/replaced-html'), name: 'Replace' },
  ]

  return (
    <div>
      <div>pathname: {pathname}</div>
      <div>segment: {segment}</div>
      <div>segments: {segments.join(',')}</div>
      <div>
        searchparams:
        <ul>
          {searchParamsList.map(([key, value]) => (
            <li key={key}>
              {key}: {value}
            </li>
          ))}
        </ul>
      </div>
      <div>
        params:
        <ul>
          {Object.entries(params).map(([key, value]) => (
            <li key={key}>
              {key}: {value}
            </li>
          ))}
        </ul>
      </div>
      {routerActions.map(({ cb, name }) => (
        <div key={name} style={{ marginBottom: '1em' }}>
          <button type="button" onClick={cb}>
            {name}
          </button>
        </div>
      ))}
    </div>
  )
}

type Story = StoryObj<typeof Component>

export default {
  component: Component,
  parameters: {
    nextjs: {
      appDirectory: true,
      navigation: {
        pathname: '/hello',
        query: {
          foo: 'bar',
        },
      },
    },
  },
} as Meta<typeof Component>

export const Default: Story = {
  play: async ({ canvasElement, step }) => {
    const canvas = within(canvasElement)
    const routerMock = getRouter()

    await step('Asserts whether forward hook is called', async () => {
      const forwardBtn = await canvas.findByText('Go forward')
      await userEvent.click(forwardBtn)
      await expect(routerMock.forward).toHaveBeenCalled()
    })
  },
}

export const WithSegmentDefined: Story = {
  parameters: {
    nextjs: {
      appDirectory: true,
      navigation: {
        segments: ['dashboard', 'settings'],
      },
    },
  },
}

export const WithRouteParams: Story = {
  parameters: {
    nextjs: {
      appDirectory: true,
      navigation: {
        pathname: '/safes/[address]',
        // Tuple form: app-router-provider reads `[name, value]` pairs and
        // surfaces them via `useParams()`. Object form crashes the tree
        // builder because it spreads `segments` as an iterable.
        segments: [['address', '0xdeadbeef']],
      },
    },
  },
}

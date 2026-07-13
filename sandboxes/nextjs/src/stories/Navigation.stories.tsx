import {
  useParams,
  usePathname,
  useRouter,
  useSearchParams,
  useSelectedLayoutSegment,
  useSelectedLayoutSegments,
} from 'next/navigation'
import { useEffect, useState } from 'react'
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
        // surfaces them via `useParams()`.
        segments: [['address', '0xdeadbeef']],
      },
    },
  },
}

// Regression guard: the documented plain-object route-param form must render.
// It previously threw `segments is not iterable` in the layout-tree builder
// before the object branch in app-router-provider could handle it.
export const WithObjectRouteParams: Story = {
  parameters: {
    nextjs: {
      appDirectory: true,
      navigation: {
        pathname: '/safes/[address]',
        segments: { address: '0xdeadbeef' },
      },
    },
  },
}

// Regression guard: an App Router action override supplied via the documented
// `navigation` parameter must reach the `next/navigation` mock. It was ignored
// while the loader seeded `createNavigation` from the Pages Router `router`.
//
// The override forwards its argument to a React state setter so the effect is
// DOM-observable: when the override is NOT wired (the bug), clicking push hits
// the default mock and the readout stays `none`; when wired, it shows the arg.
// Asserted end-to-end by nextjs.spec.ts (the Playwright regression gate).
let overrideListener: ((arg: string) => void) | null = null
const pushOverride = (arg: string) => overrideListener?.(arg)

function NavigationOverrideProbe() {
  const router = useRouter()
  const [pushedArg, setPushedArg] = useState<string>('none')

  useEffect(() => {
    overrideListener = setPushedArg
    return () => {
      overrideListener = null
    }
  }, [])

  return (
    <div>
      <div>pushed-arg: {pushedArg}</div>
      <button type="button" onClick={() => router.push('/push-html')}>
        Push HTML
      </button>
    </div>
  )
}

export const WithNavigationOverride: StoryObj<typeof NavigationOverrideProbe> =
  {
    render: () => <NavigationOverrideProbe />,
    parameters: {
      nextjs: {
        appDirectory: true,
        navigation: {
          push: pushOverride,
        },
      },
    },
  }

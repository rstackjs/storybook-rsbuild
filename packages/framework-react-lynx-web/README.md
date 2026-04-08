# storybook-react-lynx-web-rsbuild

Storybook for ReactLynx Web and Rsbuild: Develop ReactLynx components in isolation with Hot Reloading.

> **Experimental.** This framework wraps your existing `@lynx-js/rspeedy`
> pipeline and renders each story through the upstream `<lynx-view>`
> custom element. See [Limitations](#limitations) before adopting.

## Installation

```bash
npm install storybook-react-lynx-web-rsbuild \
  @lynx-js/react @lynx-js/rspeedy @lynx-js/react-rsbuild-plugin \
  @lynx-js/web-core @lynx-js/web-elements
```

You also need a `lynx.config.ts` in your project root that invokes
`pluginReactLynx()` and lists every component you want to render as a
`source.entry` — see [Usage](#usage).

## Usage

In your `.storybook/main.ts`:

```ts
import type { StorybookConfig } from 'storybook-react-lynx-web-rsbuild'

const config: StorybookConfig = {
  stories: ['../src/**/*.stories.@(js|jsx|ts|tsx)'],
  addons: ['@storybook/addon-docs'],
  framework: {
    name: 'storybook-react-lynx-web-rsbuild',
    options: {},
  },
}

export default config
```

In your project root `lynx.config.ts`:

```ts
import { pluginReactLynx } from '@lynx-js/react-rsbuild-plugin'
import { defineConfig } from '@lynx-js/rspeedy'

export default defineConfig({
  plugins: [pluginReactLynx()],
  environments: {
    web: {},
    lynx: {},
  },
  source: {
    entry: {
      // One entry per component you want to render in Storybook.
      Button: './src/components/button-entry.tsx',
    },
  },
})
```

Each entry file simply mounts your component:

```tsx
// src/components/button-entry.tsx
import { root } from '@lynx-js/react'

import { Button } from './Button.tsx'
import './Button.css'

root.render(<Button />)
```

Then write a story that points at the built `.web.bundle`:

```ts
// src/components/Button.stories.ts
import type { Meta, StoryObj } from 'storybook-react-lynx-web-rsbuild'

const meta = {
  title: 'Example/Button',
  parameters: {
    lynx: {
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
  args: { primary: true, label: 'Button' },
}
```

Read Storybook args inside your component via `useGlobalProps()` from
`@lynx-js/react`. Augment the `GlobalProps` interface for type safety:

```tsx
import { useGlobalProps } from '@lynx-js/react'

declare module '@lynx-js/react' {
  interface GlobalProps {
    label?: string
    primary?: boolean
  }
}

export function Button() {
  const { label = 'Button', primary = false } = useGlobalProps()
  // ...
}
```

## Framework Options

### `lynxConfigPath`

Path to your rspeedy/lynx config file, relative to the project root.
Defaults to `lynx.config.ts` (also tries `.js`, `.mts`, `.mjs`).

```ts
framework: {
  name: 'storybook-react-lynx-web-rsbuild',
  options: {
    lynxConfigPath: 'config/lynx.config.ts',
  },
}
```

### `lynxBundlePrefix`

URL prefix under which compiled `.web.bundle` files are served. Defaults
to `/lynx-bundles`. Your story's `parameters.lynx.url` must start with
this prefix.

## Features

- Runs your own `@lynx-js/rspeedy` pipeline in-process (no sidecar dev
  server to manage)
- JS HMR with Fast Refresh state preservation for background-thread edits
- CSS hot reload via SSE (edits to `.css/.scss/.less/...` refresh the
  `<lynx-view>` template without dropping the bundle cache)
- Storybook controls update via `updateGlobalProps()` without remounting
  — your component state survives arg changes
- Production build via `storybook build` that runs `rspeedy build`
  in-process and copies `.web.bundle` + static assets into the Storybook
  output

## Limitations

- **No Docs mode inline rendering.** ReactLynx components only run inside
  a `<lynx-view>` with WASM + Worker; docs pages that embed stories will
  render the empty custom element host.
- **No `play()` interaction tests yet.** The component lives inside a
  shadow root and a cross-thread worker; upstream test harnesses need
  more work.
- **No automatic args docgen.** `react-docgen` does not understand the
  ReactLynx transforms.
- **Each story spawns a Worker.** Lynx runs background-thread JS in a
  dedicated Web Worker; switching between many stories in one session
  will accumulate memory pressure.
- **Browser requirements match `@lynx-js/web-core`:** Chrome ≥ 92,
  Safari ≥ 16.4.

## 🤖 Agent Skills

Using an AI coding agent? Install the agent skills for guided setup:
`npx skills add rstackjs/agent-skills --skill storybook-rsbuild`

## License

MIT

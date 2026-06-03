# storybook-react-lynx-web-rsbuild

Storybook for ReactLynx Web and Rsbuild: Develop ReactLynx components in isolation with Hot Reloading.

> **Experimental.** This framework wraps your existing `@lynx-js/rspeedy`
> pipeline and renders each story through the upstream `<lynx-view>`
> custom element. Your `lynx.config.ts` is reused untouched. See
> [Limitations](#limitations) before adopting.

> 📖 Full guide:
> [storybook.rsbuild.rs/guide/framework/react-lynx-web](https://storybook.rsbuild.rs/guide/framework/react-lynx-web)

## Requirements

- An existing `@lynx-js/rspeedy` project with `pluginReactLynx()`.
- `@lynx-js/rspeedy` ≥ 0.14.0, `@lynx-js/react` ≥ 0.121.0,
  `@lynx-js/web-core` ≥ 0.21.0, `@lynx-js/web-elements` ≥ 0.12.0,
  `@rsbuild/core` ≥ 2.0.0, `storybook` ≥ 10.1.0.
- Node.js ≥ 20.6.0.
- Browser support matches `@lynx-js/web-core`: Chrome ≥ 92, Safari ≥ 16.4.

## Installation

Your Lynx project already provides `@lynx-js/react`, `@lynx-js/rspeedy`, and
`@lynx-js/react-rsbuild-plugin`. Add the framework and the web runtime:

```bash
npm install -D storybook-react-lynx-web-rsbuild \
  @lynx-js/web-core @lynx-js/web-elements @rsbuild/core
```

You also need a `lynx.config.ts` in your project root that invokes
`pluginReactLynx()` — see [Usage](#usage).

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

In your project root `lynx.config.ts` — this is your ordinary
`@lynx-js/rspeedy` config (the same one `rspeedy dev`/`build` use), reused
untouched. No `source.entry` is required for the common case; the framework
injects its own dispatcher entry onto a private clone:

```ts
import { pluginReactLynx } from '@lynx-js/react-rsbuild-plugin'
import { defineConfig } from '@lynx-js/rspeedy'

export default defineConfig({
  plugins: [pluginReactLynx()],
  environments: {
    web: {},
    lynx: {},
  },
})
```

> **The `web` environment is required.** This framework renders the web
> target. If your config declares an `environments` map it must include a
> `web` key (an empty `web: {}` is fine; a config with no `environments`
> block at all is also fine — rspeedy synthesizes a default web env).
> Otherwise Storybook fails to start with a branded
> <code>… but none named&nbsp;`web`</code> error.

Create `.storybook/lynx-preview.tsx` and register every component you
want to expose to stories:

```tsx
// .storybook/lynx-preview.tsx
import { createLynxStorybook } from 'storybook-react-lynx-web-rsbuild/runtime'

import { Button } from '../src/components/Button.tsx'

// Register your components by name. Pass each component directly — a story's
// `args` are spread onto the matching component as props, so there are no
// `() => <Button />` wrappers and no manual prop threading. Each component
// imports its own styles (e.g. `import './Button.css'` inside Button.tsx).
createLynxStorybook({
  components: { Button },
})
```

Then write a story and reference the component by name:

```ts
// src/components/Button.stories.ts
import type { Meta, StoryObj } from 'storybook-react-lynx-web-rsbuild'

const meta = {
  title: 'Example/Button',
  parameters: {
    lynx: {
      // Matches a key from the `components` map in lynx-preview.tsx.
      // The framework dispatches to it via a single auto-injected
      // `__storybook__.web.bundle`, so you don't add a `source.entry`
      // per component.
      component: 'Button',
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

Your component receives the story's `args` as ordinary props, so it reads
them the same way it would anywhere else:

```tsx
export function Button(
  { label = 'Button', primary = false }: { label?: string; primary?: boolean },
) {
  // `label` / `primary` come straight from the story's `args`.
}
```

### Run

Add the standard Storybook scripts and start the dev server:

```json
{
  "scripts": {
    "storybook": "storybook dev",
    "build-storybook": "storybook build"
  }
}
```

The first start **blocks while rspeedy compiles the `.web.bundle`** — this is
expected, not a hang. Once it's ready, your story renders inside a
`<lynx-view>` and Storybook Controls update it live. For a complete runnable
reference, see the
[`react-lynx-web` sandbox](https://github.com/rstackjs/storybook-rsbuild/tree/main/sandboxes/react-lynx-web).

### Escape hatch: `url`

For advanced cases — remote bundles, custom prefixes, or a bundle hosted
outside the framework — point `parameters.lynx.url` at the bundle directly.
Prefer `component:` above for day-to-day use.

```ts
parameters: { lynx: { url: 'https://cdn.example.com/my.web.bundle' } }
```

Resolution order is `url` → `component`. If the active `component:` is not
registered in `.storybook/lynx-preview.tsx`, the runtime dispatcher renders a
visible error listing the registered component names (so a typo is obvious); if
the whole `.storybook/lynx-preview.*` file is missing, the preview shows an
inline error telling you where to create it. Pass a `fallback` to
`createLynxStorybook({ components, fallback })` to render your own placeholder
for the unselected/unknown cases instead.

Components that prefer to read the raw `globalProps` bag (instead of taking
args as props) can still call `useGlobalProps()` from `@lynx-js/react` — the
dispatcher leaves the bag intact. Augment the `GlobalProps` interface for type
safety:

```tsx
import { useGlobalProps } from '@lynx-js/react'

declare module '@lynx-js/react' {
  interface GlobalProps {
    label?: string
    primary?: boolean
  }
}
```

## Configuration model

This framework spans **three** configuration surfaces. Knowing which paradigm
each one is removes the "do I set this in Lynx-style or Rsbuild-style?"
ambiguity:

| Surface | Style | Controls |
| :--- | :--- | :--- |
| `lynx.config.ts` | **Lynx / rspeedy** | How your **component** `.web.bundle` is compiled (loaders, plugins, environments, `output`). Reused untouched. |
| `main.ts` → `rsbuildFinal` / `tools.rspack` | **Rsbuild / Rspack** | How Storybook's **preview shell** is built (the builder is `storybook-builder-rsbuild`). |
| `main.ts` → `framework` / `options` / `stories` / `addons` | **Storybook** | Storybook itself. |

**Rule of thumb:** if your component code imports or uses it, configure it in
`lynx.config.ts`. If it only affects Storybook's own preview page, use
`rsbuildFinal`. These are two different Rspack compilations: your
`lynx.config.ts` builds the component `.web.bundle`; `rsbuildFinal` tunes the
preview shell that hosts it.

### Deep build tuning: `rsbuildFinal`

Because the builder is `storybook-builder-rsbuild`, tune the Storybook
**preview** build with `rsbuildFinal` / `tools.rspack` in `.storybook/main.ts`
— this does **not** touch the Lynx `.web.bundle` (that is built by your
`lynx.config.ts`):

```ts
import { mergeRsbuildConfig } from '@rsbuild/core'

const config: StorybookConfig = {
  framework: { name: 'storybook-react-lynx-web-rsbuild', options: {} },
  rsbuildFinal: (config) =>
    mergeRsbuildConfig(config, {
      // customize the preview build here
    }),
}
```

## Framework Options

These are Storybook framework options — they live in `.storybook/main.ts`
under `framework.options` (not in `lynx.config.ts`).

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

URL prefix under which compiled `.web.bundle` files are served in a
production build. Defaults to `/lynx-bundles`. The dispatcher picks this up
automatically; stories that pass an explicit `parameters.lynx.url` must
include the matching prefix themselves. (In dev the bundle is served from the
mounted rspeedy server's root, so this prefix does not apply there.)

### `builder.lazyCompilation`

The framework disables rsbuild lazy compilation in dev by default, because
it breaks `@lynx-js/web-core`'s WASM worker (the async-wasm runtime helper is
never installed in the worker, crashing dev with
`__webpack_require__.v is not a function`). For a large component library you
can opt back in:

```ts
framework: {
  name: 'storybook-react-lynx-web-rsbuild',
  options: {
    builder: { lazyCompilation: true },
  },
}
```

## Features

- Runs your own `@lynx-js/rspeedy` pipeline in-process and mounts its dev
  server directly into Storybook's own server — single origin, no sidecar
  process and no reverse proxy to manage
- Editing a **story** soft-updates through Storybook's own HMR — no full page
  reload; the `<lynx-view>` re-renders with the new args/parameters
- Editing **component source** live-reloads the preview to pick up the rebuilt
  bundle (the `web` target has no React Fast-Refresh, so a rebuild is a reload)
- Tweaking a control updates via `updateGlobalProps()` without remounting
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
- **Storybook must be served from the origin root.** The preview pins its
  asset `publicPath` to `/` (web-core's worker resolves shared chunks by
  absolute path), so a `storybook build` deployed under a sub-path — e.g.
  `https://host/storybook/` — would request preview assets from `/static/…`
  and 404. Deploy the static output at the root, or front it with a rewrite.

## 🤖 Agent Skills

Using an AI coding agent? Install the agent skills for guided setup:
`npx skills add rstackjs/agent-skills --skill storybook-rsbuild`

## License

MIT

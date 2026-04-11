# Storybook-Rsbuild Support for Lynx Web - Feasibility Study

> Date: 2026-04-03
> Status: Research complete, pending PoC validation

## Background

Investigate whether storybook-rsbuild can provide build support for Lynx Web (specifically ReactLynx), similar to how `framework-react-native-web` works for React Native Web.

- Lynx official site: https://lynxjs.org
- Lynx source: `/Users/bytedance/Projects/lynx-stack`
- Storybook-rsbuild source: `/Users/bytedance/Projects/storybook-rsbuild`

## Key Findings

### Lynx Web Architecture

1. **ReactLynx is built on Preact** (`@lynx-js/internal-preact`), NOT React. Component model uses Lynx-specific elements (`<view>`, `<text>`, `<image>`) instead of HTML elements (`<div>`, `<span>`, `<img>`).

2. **Dual-threaded execution**: Main thread (DOM rendering via WASM) + Background thread (Web Worker runs JS/React logic). This is transparent to the `<lynx-view>` consumer.

3. **`<lynx-view>` is a standard Web Component** that encapsulates the full Lynx runtime (Shadow DOM + WASM + Worker). Can be embedded in any HTML page:
   ```html
   <script src="@lynx-js/web-core/dist/client_prod/static/js/client.js" type="module"></script>
   <lynx-view url="http://localhost:3000/main/main-thread.js" style="height:100vh;width:100vw;"></lynx-view>
   ```

4. **WASM is required but NOT a blocker** - it loads fine in browsers with automatic fallback (modern SIMD → legacy). Browser requirements: Chrome >= 92, Safari >= 16.4.

5. **Build pipeline**: ReactLynx JSX → SWC plugins (`@lynx-js/react-transform`, `swc-plugin-reactlynx`) → snapshot opcodes → `.web.bundle` files. This is NOT standard React JSX transform and cannot be skipped.

6. **rspeedy** (Lynx's build tool) wraps Rsbuild and uses `environments` (`web`, `lynx`) to produce platform-specific bundles.

### Key Lynx Packages

| Package | Purpose |
|---------|---------|
| `@lynx-js/react` | ReactLynx framework (Preact-based) |
| `@lynx-js/rspeedy` | Build tool wrapping Rsbuild |
| `@lynx-js/react-rsbuild-plugin` | Rsbuild plugin for ReactLynx (SWC transforms + layer splitting) |
| `@lynx-js/web-core` | Web runtime (WASM + LynxView custom element) |
| `@lynx-js/web-elements` | Custom HTML elements (`x-view`, `x-text`, etc.) |
| `@lynx-js/web-platform-rsbuild-plugin` | Rsbuild plugin for web platform polyfills |
| `@lynx-js/web-rsbuild-server-middleware` | Dev server middleware for `__web_preview` |
| `@lynx-js/web-explorer` | Browser-based Lynx component viewer (reference implementation) |

### Key Source Files in lynx-stack

- `packages/web-platform/web-explorer/index.ts` — **Reference implementation** of embedding `<lynx-view>` in a web page
- `packages/web-platform/web-core/ts/client/mainthread/LynxView.ts` — `<lynx-view>` custom element definition
- `packages/web-platform/web-core/ts/client/mainthread/Background.ts` — Worker lifecycle (mandatory, no same-thread mode)
- `packages/web-platform/web-core/ts/client/wasm.ts` — WASM loading strategy (modern + legacy fallback)
- `packages/web-platform/web-rsbuild-plugin/src/pluginWebPlatform.ts` — Web platform Rsbuild plugin
- `packages/rspeedy/plugin-react/src/pluginReactLynx.ts` — ReactLynx Rsbuild plugin (SWC + loaders + layer splitting)
- `packages/rspeedy/plugin-react/src/loaders.ts` — Layer-specific loaders (`LAYERS.BACKGROUND`, `LAYERS.MAIN_THREAD`)
- `packages/rspeedy/plugin-react/src/entry.ts` — Entry point splitting logic
- `packages/react/runtime/src/index.ts` — ReactLynx exports (hooks, components, Lynx-specific APIs)

### Why React Native Web Approach Does NOT Apply

| Dimension | React Native Web | ReactLynx Web |
|-----------|-----------------|---------------|
| Runtime | React (same) | Preact (different) |
| Integration | Alias `react-native` → `react-native-web` | Full build pipeline + web runtime |
| Components | RN components → DOM elements | Lynx elements → WASM opcodes → custom elements |
| Threading | Single thread | Dual thread (Worker mandatory) |
| JSX | Standard React JSX | Custom SWC snapshot transform |
| Renderer | `@storybook/react` works | Cannot use `@storybook/react` |

## Recommended Approach: Framework with `<lynx-view>` Embedding

### Architecture

```
┌─────────────────────────────────────────────────┐
│  Storybook UI (sidebar, controls, addons)       │
│  ┌───────────────────────────────────────────┐  │
│  │  Preview iframe                           │  │
│  │  ┌─────────────────────────────────────┐  │  │
│  │  │  <lynx-view                         │  │  │
│  │  │    url="/stories/Button.web.bundle" │  │  │
│  │  │    globalProps={args}               │  │  │
│  │  │    height="auto" />                 │  │  │
│  │  │                                     │  │  │
│  │  │  (Shadow DOM + Worker + WASM)       │  │  │
│  │  └─────────────────────────────────────┘  │  │
│  └───────────────────────────────────────────┘  │
└─────────────────────────────────────────────────┘
```

Storybook handles the UI shell + controls. `<lynx-view>` renders actual Lynx components. Data flows through `globalProps` / `initData` bridging from Storybook args.

### Implementation Plan

#### 1. Build Bridging (~60% effort)

**Core challenge**: Storybook compiles all stories into one bundle; ReactLynx needs separate `.web.bundle` per story.

**Options**:
- **Option A: Rsbuild multi-environment** — Add a `lynx-web` environment to Storybook's Rsbuild config. The `storybook` environment compiles UI + story metadata; the `lynx-web` environment uses `pluginReactLynx()` to compile actual components.
- **Option B: Sidecar build** — Run rspeedy dev server alongside Storybook, watch story component files, output `.web.bundle` files. Storybook references these via URL.

#### 2. Rendering Bridging (~25% effort)

Create a `framework-react-lynx-web` package:

```typescript
// preset.ts — rsbuildFinal hook
export const rsbuildFinal = async (config) => {
  return mergeRsbuildConfig(config, {
    html: {
      tags: [
        { tag: 'script', attrs: { type: 'module', src: '@lynx-js/web-core/client' } },
        { tag: 'link', attrs: { rel: 'stylesheet', href: '@lynx-js/web-core/client.css' } },
      ],
    },
    plugins: [pluginWebPlatform()],
  })
}
```

Preview render function:
```typescript
function renderStory(storyFn, context) {
  const lynxView = document.createElement('lynx-view')
  lynxView.url = `/stories/${context.id}.web.bundle`
  lynxView.globalProps = context.args  // args → globalProps bridge
  lynxView.style.height = 'auto'
  lynxView.style.width = '100%'
  return lynxView
}
```

#### 3. Story Format Adaptation (~15% effort)

Define how ReactLynx stories are written and how args map to `globalProps` / `initData`.

### `<lynx-view>` API for Storybook Integration

From `LynxView.ts`, key properties for bridging:

| Property | Type | Purpose in Storybook |
|----------|------|---------------------|
| `url` | string | Points to the story's `.web.bundle` |
| `globalProps` | object | Bridge from Storybook `args` (reactive updates) |
| `initData` | object | Initial data for the component |
| `onNativeModulesCall` | callback | Intercept native module calls (for actions addon) |
| `height` / `width` | string | `"auto"` for auto-sizing |

Updating `globalProps` triggers a re-render inside `<lynx-view>` — this is the primary mechanism for Storybook controls integration.

### V1 Scope

**Supported**:
- Browse and render ReactLynx components in Storybook
- Args/controls via `globalProps` / `initData` bridging
- Story switching (change `<lynx-view>` URL)
- Theme switching (via `globalProps`)

**NOT supported (future iterations)**:
- Component-level HMR (full `<lynx-view>` reload needed)
- Storybook `play()` interaction tests
- Docs mode inline component rendering
- Auto props documentation extraction (react-docgen not applicable)

### Key Risks

1. **Rsbuild multi-environment in Storybook builder** — Not tested. Need to verify `storybook-builder-rsbuild` can handle multiple environments.
2. **Per-story bundle compilation** — Each story = separate entry point. May be slow for large story sets.
3. **Worker lifecycle** — Each `<lynx-view>` spawns a Web Worker. Switching between many stories may have memory/performance implications.
4. **CORS / headers** — `<lynx-view>` may need `Cross-Origin-Isolation` headers for SharedArrayBuffer.

### Suggested PoC Steps

1. In a standalone HTML page, load `@lynx-js/web-core/client` and render `<lynx-view>` with a pre-built `.web.bundle` — verify basic rendering works.
2. Do the same inside Storybook's preview iframe (via a custom decorator or addon) — verify WASM + Worker loads correctly in Storybook's context.
3. Test `globalProps` reactivity — update args from Storybook controls and confirm `<lynx-view>` re-renders.
4. Prototype the build bridging — either multi-environment or sidecar.

### Reference: Existing Storybook Framework Patterns

- `packages/framework-react-native-web/` — Best reference for extending a framework with platform-specific plugin
- `packages/framework-html/` — Simplest framework, could be the base for `framework-react-lynx-web`
- `packages/builder-rsbuild/src/preview/iframe-rsbuild.config.ts` — Where Rsbuild config is assembled
- `packages/builder-rsbuild/src/types.ts` — `BuilderOptions` includes `environment` field

### Reference: Lynx Component Example

```tsx
// A typical ReactLynx component
import { useState, useCallback } from '@lynx-js/react'

export function Button({ label, primary }) {
  const [count, setCount] = useState(0)

  const onTap = useCallback(() => {
    'background-only'
    setCount(c => c + 1)
  }, [])

  return (
    <view className={primary ? 'btn-primary' : 'btn-default'} bindtap={onTap}>
      <text>{label} (tapped {count} times)</text>
    </view>
  )
}
```

Key differences from React:
- Elements: `<view>`, `<text>` instead of `<div>`, `<span>`
- Events: `bindtap` instead of `onClick`
- Thread directive: `'background-only'` string marks code for Worker execution
- Imports from `@lynx-js/react`, not `react`

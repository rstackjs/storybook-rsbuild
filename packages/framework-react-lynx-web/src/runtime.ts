/**
 * Dispatcher runtime for Storybook stories. Imported from the user's
 * `.storybook/lynx-preview.{tsx,ts,jsx,js}`, which the framework's `preset.ts`
 * auto-injects into rspeedy as a synthetic `__storybook__` entry.
 *
 * Execution context: this module runs **inside the Lynx bundle** (mainthread
 * JS, processed by `pluginReactLynx` and consuming the user's `@lynx-js/react`),
 * NOT inside Storybook's preview iframe. Do not import anything from this
 * package's other entries — they are compiled for a different runtime.
 *
 * Reactivity model: the framework's `preview.ts` writes the selected component
 * name into `<lynx-view>.globalProps.__storybookComponent` on mount, and uses
 * `updateGlobalProps(...)` on arg wiggles. The runtime's `updateGlobalProps`
 * path force-flushes the whole React tree via `runWithForce(render)`
 * (lynx-stack `packages/react/runtime/src/lynx/tt.ts`), so a plain
 * `lynx.__globalProps` read is picked up on every re-render without any
 * subscription hook.
 *
 * Deliberately NOT using `useGlobalProps()` from `@lynx-js/react` because
 * that only subscribes reactively in `__GLOBAL_PROPS_MODE__ === 'event'`
 * (see `packages/react/runtime/src/lynx-api.ts` in lynx-stack). The
 * force-flush path above is mode-agnostic and covers both cases.
 */
import { type ReactNode, root } from '@lynx-js/react'
import { jsx } from '@lynx-js/react/jsx-runtime'

declare const lynx: { __globalProps: Record<string, unknown> }

type LynxComponent = () => ReactNode

export interface LynxStorybookOptions {
  /**
   * Map of component name → render function. The framework looks up the
   * active story's `parameters.lynx.component` against the keys of this map.
   */
  components: Record<string, LynxComponent>
  /**
   * Optional placeholder rendered when no component is selected yet, or
   * when the selected name is not in `components`. Defaults to an empty
   * `<view />`.
   */
  fallback?: () => ReactNode
}

/**
 * Register a Storybook dispatcher with the Lynx runtime. Call this exactly
 * once from `.storybook/lynx-preview.{tsx,ts,jsx,js}`; the framework injects
 * that file as a synthetic rspeedy entry so this call runs on bundle load.
 */
export function createLynxStorybook(options: LynxStorybookOptions): void {
  const { components, fallback } = options

  function Dispatcher(): ReactNode {
    // Plain property read — see the reactivity note at the top of the file
    // for why this is sufficient and intentional.
    const bag = lynx.__globalProps
    const name = bag?.__storybookComponent as string | undefined
    const Component = name ? components[name] : undefined
    if (!Component) {
      return fallback ? fallback() : jsx('view', {})
    }
    return jsx(Component, {})
  }

  root.render(jsx(Dispatcher, {}))
}

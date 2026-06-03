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
import { jsx, jsxs } from '@lynx-js/react/jsx-runtime'

declare const lynx: { __globalProps: Record<string, unknown> }

/**
 * Reserved `globalProps` key carrying the active story's selected component
 * name. Everything else in the bag is the story's own args and is spread onto
 * the component as props. Keep this in sync with `preview.ts`, which writes it.
 */
const SELECTOR_KEY = '__storybookComponent'

/**
 * A registry entry is just the user's real ReactLynx component. It receives
 * the story's args as props — so prop-driven components (the common case in
 * lynx-examples / lynx-ui, e.g. `App({ src })`) work unchanged. Components
 * that still read `lynx.__globalProps` directly also keep working because the
 * bag is left intact.
 */
type LynxComponent = (props: Record<string, unknown>) => ReactNode

export interface LynxStorybookOptions {
  /**
   * Map of component name → ReactLynx component. The framework looks up the
   * active story's `parameters.lynx.component` against the keys of this map
   * and renders the match with the story's args spread as props.
   *
   * Pass the components directly — no `() => <Button />` wrappers and no
   * manual prop threading:
   *
   * ```tsx
   * createLynxStorybook({ components: { Button, Card } })
   * ```
   */
  components: Record<string, LynxComponent>
  /**
   * Optional placeholder rendered when no component is selected yet, or when
   * the selected name is not in `components`. When omitted, a *present but
   * unknown* name (almost always a typo in a story's
   * `parameters.lynx.component`) renders a visible diagnostic listing the
   * registered keys instead of a blank canvas; a *missing* selection renders
   * an empty `<view />` (the preview iframe already surfaces that case).
   * Providing a `fallback` opts out of both and takes over rendering.
   */
  fallback?: () => ReactNode
}

/**
 * Visible in-bundle error for an unknown `parameters.lynx.component`. Built
 * from Lynx elements (this runs inside the Lynx bundle, not the iframe DOM)
 * and lists the actually-registered names. Those names only exist at runtime
 * as the keys of the `components` map — there is no static registry to read
 * at config time, which is why the diagnostic lives here rather than on the
 * preview side.
 */
function renderUnknownComponent(name: string, available: string[]): ReactNode {
  const lines: ReactNode[] = [
    jsx('text', {
      style: 'color:#b00020;font-size:17px;font-weight:bold;',
      children: `Unknown component "${name}"`,
    }),
    jsx('text', {
      style: 'color:#5a0f17;font-size:13px;margin-top:8px;',
      children:
        `parameters.lynx.component = ${JSON.stringify(name)} is not ` +
        `registered via createLynxStorybook({ components }) in ` +
        `.storybook/lynx-preview.*.`,
    }),
    jsx('text', {
      style: 'color:#5a0f17;font-size:13px;margin-top:12px;',
      children: available.length
        ? 'Registered components:'
        : 'No components are registered yet.',
    }),
    ...available.map((n) =>
      jsx(
        'text',
        { style: 'color:#5a0f17;font-size:13px;', children: `• ${n}` },
        n,
      ),
    ),
  ]
  return jsxs('view', {
    style:
      'display:flex;flex-direction:column;padding:24px;background-color:#fff3f3;',
    children: lines,
  })
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
    //
    // Split the flat globalProps bag into the selector key and the story's
    // own args, then spread the args onto the selected component as props.
    // This is what lets stock prop-driven components render from a story's
    // `args` without the component having to read `lynx.__globalProps`.
    const bag = (lynx.__globalProps ?? {}) as Record<string, unknown>
    const { [SELECTOR_KEY]: name, ...args } = bag
    const Component = typeof name === 'string' ? components[name] : undefined
    if (Component) return jsx(Component, args)
    // A user-supplied fallback wins for both "nothing selected" and "unknown
    // name" — they explicitly opted into custom handling.
    if (fallback) return fallback()
    // No fallback: make a present-but-unknown name loud (it is almost always
    // a typo) instead of silently rendering a blank view.
    if (typeof name === 'string' && name.length > 0) {
      return renderUnknownComponent(name, Object.keys(components))
    }
    // Nothing selected yet; the preview iframe already surfaces that case, so
    // an empty view here is the correct quiet default.
    return jsx('view', {})
  }

  root.render(jsx(Dispatcher, {}))
}

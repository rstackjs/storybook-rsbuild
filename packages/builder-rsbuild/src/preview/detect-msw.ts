import type { Options, StorybookConfigRaw } from 'storybook/internal/types'

const MSW_ADDON_BASENAME = 'msw-storybook-addon'

/**
 * Detect whether the current Storybook setup integrates MSW via
 * `msw-storybook-addon`. Used to opt out of lazy compilation when MSW is
 * present, because the Service Worker races with the dev-server lazy
 * compilation RPC (`/lazy-compilation-using-*`) and can leave the preview
 * iframe blank.
 */
export async function isMswAddonEnabled(options: Options): Promise<boolean> {
  const addons = await options.presets.apply<StorybookConfigRaw['addons']>(
    'addons',
    [],
  )
  return (addons ?? []).some((entry) => {
    const name =
      typeof entry === 'string'
        ? entry
        : ((entry as { name?: string })?.name ?? '')
    if (!name) return false
    const basename = name.split(/[\\/]/).pop() ?? name
    return basename === MSW_ADDON_BASENAME
  })
}

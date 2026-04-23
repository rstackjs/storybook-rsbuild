import { existsSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'
import type { Options, StorybookConfigRaw } from 'storybook/internal/types'

const MSW_SW_FILE = 'mockServiceWorker.js'

/**
 * Detect whether the current Storybook setup serves MSW's Service Worker.
 * We probe each entry in `staticDirs` for `mockServiceWorker.js`, which is
 * present whenever the user has run `msw init`. This is a stable signal
 * regardless of whether MSW is wired via `msw-storybook-addon` or set up
 * manually in `preview.*`.
 *
 * The `addons` preset field cannot be used here: Storybook's `loadPreset`
 * destructures `addons` out of each preset's exports and recursively loads
 * them as sub-presets, so `presets.apply('addons', [])` never yields the
 * addon names declared in `main.*` — it only reflects later-preset
 * contributions, which excludes user-level `msw-storybook-addon`.
 */
export async function isMswActive(options: Options): Promise<boolean> {
  const staticDirs = await options.presets.apply<
    StorybookConfigRaw['staticDirs']
  >('staticDirs', [])

  if (!Array.isArray(staticDirs)) return false

  return staticDirs.some((entry) => {
    const dir = typeof entry === 'string' ? entry : entry?.from
    if (typeof dir !== 'string' || dir.length === 0) return false
    const abs = isAbsolute(dir) ? dir : resolve(options.configDir, dir)
    return existsSync(resolve(abs, MSW_SW_FILE))
  })
}

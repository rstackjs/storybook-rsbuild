import type { RsbuildConfig } from '@rsbuild/core'
import type { LibConfig } from '@rslib/core'

export interface AddonOptions {
  rslib?: {
    /**
     * `cwd` passed to loadConfig of Rslib
     * @default undefined
     */
    cwd?: string
    /**
     *  `path` passed to loadConfig of Rslib
     * @default undefined
     */
    configPath?: string
    /**
     * The lib config index in `lib` field to use, will be merged with the other fields in the config.
     * Set to a number to use the lib config at that index.
     * Set to `false` to disable using the lib config.
     * @default 0
     */
    libIndex?: number | false
    /**
     * Modify the Rslib lib config before transforming it to Rsbuild config which will be merged
     * with Storybook. You can modify the configuration in the config parameters in place.
     * @experimental subject to change at any time
     * @default undefined
     */
    modifyLibConfig?: (config: LibConfig) => void
    /**
     * Modify the Rsbuild config transformed from lib config after inherited fields are stripped
     * and before merging with Storybook config. You can modify the configuration in the config
     * parameters in place, including explicitly restoring stripped fields.
     * @experimental subject to change at any time
     * @default undefined
     */
    modifyLibRsbuildConfig?: (config: RsbuildConfig) => void
  }
}

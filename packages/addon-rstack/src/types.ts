export type RstackStackOptions =
  | {
      /** Inherit `define.app()`. */
      type: 'app'
      /** For app configs with multiple environments: which one to inherit. */
      environment?: string
    }
  | {
      /** Inherit `define.lib()`. */
      type: 'lib'
      /** Which lib[] entry to inherit (default 0). false inherits only top-level config. */
      libIndex?: number | false
    }

export interface AddonOptions {
  rstack?: {
    /** Explicit config file path (absolute, or relative to the current working directory). */
    configFilePath?: string
    /** Which definition to inherit. Omit to prefer `define.app()` and fall back to `define.lib()`. */
    stack?: RstackStackOptions
  }
}

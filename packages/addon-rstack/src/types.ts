export interface AddonOptions {
  rstack?: {
    /** Explicit config file path (absolute, or relative to the current working directory). */
    configFilePath?: string
    /** Which definition to inherit. When omitted, prefers define.app() and falls back to define.lib(). */
    configType?: 'app' | 'lib'
    /** For app configs with multiple environments: which one to inherit. */
    environment?: string
    /** For lib configs: which lib[] entry to inherit (default 0). false inherits only top-level config. */
    libIndex?: number | false
  }
}

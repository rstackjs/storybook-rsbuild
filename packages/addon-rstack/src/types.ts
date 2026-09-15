export interface AddonOptions {
  rstack?: {
    /** Directory to search for rstack.config.* and resolve relative paths from. Defaults to process.cwd(). */
    cwd?: string
    /** Explicit config file path (relative to cwd or absolute). */
    configFilePath?: string
    /** Which definition to inherit. When omitted, prefers define.app() and falls back to define.lib(). */
    configType?: 'app' | 'lib'
    /** For app configs with multiple environments: which one to inherit. */
    environment?: string
    /** For lib configs: which lib[] entry to inherit (default 0). false inherits only top-level config. */
    libIndex?: number | false
  }
}

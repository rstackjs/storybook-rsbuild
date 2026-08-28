export type BuildEntry = {
  exportEntries?: ('.' | `./${string}`)[] // the keys in the package.json's export map, e.g. ["./internal/manager-api", "./manager-api"]
  entryPoint: `./src/${string}` // the source file to bundle, e.g. "./src/manager-api/index.ts"
  dts?: false // default to generating d.ts files for all entries, except if set to false
}

export type BuildEntries = {
  /**
   * The map of entry points by platform
   *
   * Each platform is optional
   */
  entries: Partial<Record<'node' | 'browser', BuildEntry[]>>
  /**
   * The map of extra outputs to be added to the package.json's exports
   *
   * This can be useful to expose non-compiled/non-js files such as Svelte components,
   */
  extraOutputs?: Record<string, string>
}

import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

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

export const getExternal = async (cwd: string) => {
  const { default: packageJson } = await import(
    pathToFileURL(join(cwd, 'package.json')).href,
    {
      with: { type: 'json' },
    }
  )

  const runtimeExternalInclude: string[] = [
    'react',
    'use-sync-external-store',
    'react-dom',
    'react-dom/client',
    '@storybook/icons',

    /**
     * @note This is not a real package, it's a hack to allow `frameworks/nextjs` to be able to alias
     * whilst also able to use the nextjs version
     *
     * @see `code/frameworks/nextjs/src/images/next-image.tsx`
     */
    'sb-original',
    packageJson.name,
    ...Object.keys(packageJson.dependencies || {}),
    ...Object.keys(packageJson.peerDependencies || {}),
  ]
  const runtimeExternalExclude = [
    '@testing-library/jest-dom',
    '@testing-library/user-event',
    'chai',
    '@vitest/expect',
    '@vitest/spy',
    '@vitest/utils',
  ]
  const runtimeExternal = runtimeExternalInclude.filter(
    (dep) => !runtimeExternalExclude.includes(dep),
  )

  return { runtimeExternal }
}

// Ported from https://github.com/storybookjs/storybook/blob/v10.6.0/code/frameworks/vue3-vite/src/plugins/vue-component-meta.ts
import type { RsbuildPlugin } from '@rsbuild/core'
import type { experimental_vueDocgenEngine } from '@storybook/vue3/preset'
import { readFile } from 'node:fs/promises'
import { parseLocalBindings } from 'storybook/internal/oxc-parser'

/** The renderer's shared vue-component-meta engine, applied through the preset chain. */
export type VueDocgenEngine = Awaited<
  ReturnType<typeof experimental_vueDocgenEngine>
>

const PLUGIN_NAME = 'storybook:vue-component-meta-plugin'

export async function vueComponentMeta(
  engine: VueDocgenEngine,
  tsconfigPath = 'tsconfig.json',
): Promise<RsbuildPlugin> {
  const { collectComponentMetaSources, createVueComponentMetaChecker } =
    await engine.componentMeta()

  const include = /\.(vue|ts|js|tsx|jsx)$/
  const exclude = [
    /\.stories\.(ts|tsx|js|jsx)$/,
    /\.storybook[\\/].*\.(ts|js)$/,
    /[\\/]node_modules[\\/]/,
    // builder-rsbuild virtual entries (upstream excludes /virtual:)
    /[\\/]storybook-(stories|config-entry)\.js$/,
  ]
  const filter = (id: string) =>
    include.test(id) && !exclude.some((pattern) => pattern.test(id))

  const checker = await createVueComponentMetaChecker(tsconfigPath)

  return {
    name: PLUGIN_NAME,
    setup(api) {
      api.transform(
        {
          test: filter,
          // skip rspack-vue-loader's `?vue&type=script` sub-requests of the same .vue file
          resourceQuery: { not: /./ },
          order: 'post',
        },
        async ({ code: src, resourcePath: id }) => {
          try {
            const metaSources = await collectComponentMetaSources(checker, id)
            if (metaSources.length === 0) {
              // upstream returns undefined here; Rsbuild's TransformResult has no
              // undefined, and returning the source unchanged keeps the incoming map.
              return src
            }

            // Re-exports resolve via the checker but have no local binding to attach to.
            const localBindings = await parseLocalBindings(id, src)
            let code = src

            for (const meta of metaSources) {
              // A compiled SFC binds its default export as `__exports__` (rspack-vue-loader) or
              // `_sfc_main` (unplugin-vue).
              const name =
                meta.exportName === 'default'
                  ? ['__exports__', '_sfc_main'].find((binding) =>
                      localBindings.has(binding),
                    )
                  : meta.exportName

              if (!name || !localBindings.has(name)) {
                continue
              }

              code += `\n;${name}.__docgenInfo = Object.assign({
            displayName: ${name}.name ?? ${name}.__name
          }, ${JSON.stringify(meta)})`
            }

            // Append-only, so returning the code keeps the incoming source map exact.
            return code
          } catch {
            return src
          }
        },
      )

      // upstream: handleHotUpdate — refresh the checker for the files Rspack reports as modified
      api.onAfterCreateCompiler(({ compiler }) => {
        const compilers =
          'compilers' in compiler ? compiler.compilers : [compiler]

        for (const instance of compilers) {
          instance.hooks.watchRun.tapPromise(PLUGIN_NAME, async (watching) => {
            for (const file of watching.modifiedFiles ?? []) {
              if (filter(file)) {
                checker.updateFile(file, await readFile(file, 'utf-8'))
              }
            }
          })
        }
      })
    },
  }
}

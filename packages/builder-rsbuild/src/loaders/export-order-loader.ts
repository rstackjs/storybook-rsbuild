// Forked from https://github.com/storybookjs/storybook/blob/a29f6dfaacee67ae7254c2a2b6b62ce1cd26a3d1/code/builders/builder-webpack5/src/loaders/export-order-loader.ts#L56.
import assert from 'node:assert'

import type { Rspack } from '@rsbuild/core'
import { init as initCjsParser, parse as parseCjs } from 'cjs-module-lexer'
import { parse as parseEs } from 'es-module-lexer'
import MagicString from 'magic-string'

export default async function loader(
  this: Rspack.LoaderContext<any>,
  source: string,
  map: any,
  meta: any,
) {
  const callback = this.async()

  try {
    const magicString = new MagicString(source)

    // Trying to parse as ES module
    if (!source.includes('__namedExportsOrder')) {
      try {
        // Do NOT remove await here. The types are wrong! It has to be awaited,
        // otherwise it will return a Promise<Promise<...>> when wasm isn't loaded.
        // eslint-disable-next-line @typescript-eslint/await-thenable
        const parseResult = await parseEs(source)
        const namedExportsOrder = (parseResult[1] || [])
          .map((e) => source.substring(e.s, e.e))
          .filter((e) => e !== 'default')

        assert(
          namedExportsOrder.length > 0,
          'No named exports found. Very likely that this is not a ES module.',
        )

        magicString.append(
          `;export const __namedExportsOrder = ${JSON.stringify(namedExportsOrder)};`,
        )

        // Try to parse as CJS module
      } catch {
        await initCjsParser()
        const namedExportsOrder = (parseCjs(source).exports || []).filter(
          (e: string) => e !== 'default' && e !== '__esModule',
        )

        assert(
          namedExportsOrder.length > 0,
          'No named exports found. Very likely that this is not a CJS module.',
        )

        magicString.append(
          `;module.exports.__namedExportsOrder = ${JSON.stringify(namedExportsOrder)};`,
        )
      }
    }

    return callback(null, magicString.toString(), map, meta)
  } catch (_err) {
    return callback(null, source, map, meta)
  }
}

import type { Rspack } from '@rsbuild/core'
import { rewriteSbMockImportCalls } from 'storybook/internal/mocking-utils'
import { logger } from 'storybook/internal/node-logger'

const storybookMockTransformLoader = function (
  this: Rspack.LoaderContext<any>,
  source: string,
  sourceMap: any,
  meta: any,
) {
  const callback = this.async()

  try {
    const result = rewriteSbMockImportCalls(source, this.resourcePath)
    callback(
      null,
      result.code,
      result.map ? { ...result.map, file: this.resourcePath } : sourceMap,
      meta,
    )
  } catch (error) {
    logger.debug(
      `Could not transform sb.mock(import(...)) calls in ${this.resourcePath}: ${String(error)}`,
    )
    callback(null, source, sourceMap, meta)
  }
}

export default storybookMockTransformLoader

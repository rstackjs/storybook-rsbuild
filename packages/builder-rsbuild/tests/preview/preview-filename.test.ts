import { type Rspack, rspack } from '@rsbuild/core'
import { describe, expect, it } from '@rstest/core'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  developmentPreviewChunkFilename,
  productionPreviewChunkFilename,
} from '../../src/preview/preview-filename'

const filenameFor = (name: string, isProd = false) => {
  const pathData = { chunk: { id: name, name, hash: '' } }
  return isProd
    ? productionPreviewChunkFilename(pathData)
    : developmentPreviewChunkFilename(pathData)
}

const filenameForChunk = (chunk: { id?: string | number; name?: string }) =>
  developmentPreviewChunkFilename({
    chunk: { ...chunk, hash: '' } as NonNullable<Rspack.PathData['chunk']>,
  })

const compile = async (source: string, isProd: boolean) => {
  const entryName = 'preview'
  const longChunkName = `chunk-${'deeply-nested-'.repeat(30)}component`
  const root = mkdtempSync(join(tmpdir(), 'preview-filename-'))
  const sourceDir = join(root, 'src')
  mkdirSync(sourceDir)
  writeFileSync(
    join(sourceDir, 'entry.js'),
    `import(/* webpackChunkName: "${longChunkName}" */ './async.js');`,
  )
  writeFileSync(join(sourceDir, 'async.js'), source)

  const compiler = rspack({
    context: root,
    mode: isProd ? 'production' : 'development',
    devtool: false,
    entry: { [entryName]: './src/entry.js' },
    output: {
      path: join(root, 'dist'),
      filename: isProd
        ? '[name].[contenthash:8].iframe.bundle.js'
        : '[name].iframe.bundle.js',
      chunkFilename: isProd
        ? productionPreviewChunkFilename
        : developmentPreviewChunkFilename,
    },
  })

  try {
    const stats = await new Promise<Rspack.Stats>((resolve, reject) => {
      compiler.run((error, result) => {
        if (error) {
          reject(error)
        } else if (result?.hasErrors()) {
          reject(new Error(result.toString({ all: false, errors: true })))
        } else if (result) {
          resolve(result)
        } else {
          reject(new Error('Rspack did not return compilation stats'))
        }
      })
    })

    return (
      stats
        .toJson({ all: false, assets: true })
        .assets?.map(({ name }) => name) ?? []
    )
  } finally {
    await new Promise<void>((resolve, reject) =>
      compiler.close((error) => (error ? reject(error) : resolve())),
    )
    rmSync(root, { recursive: true, force: true })
  }
}

describe('preview chunk filenames', () => {
  it('keeps normal development chunk names readable', () => {
    expect(filenameFor('src-components-button-stories')).toBe(
      'src-components-button-stories.iframe.bundle.js',
    )
  })

  it('uses the chunk id when the chunk name is empty', () => {
    expect(filenameForChunk({ id: '123', name: '' })).toBe(
      '123.iframe.bundle.js',
    )
  })

  it('uses a generic fallback when the chunk name and id are missing', () => {
    expect(filenameForChunk({ name: '' })).toBe('chunk.iframe.bundle.js')
    expect(filenameForChunk({})).toBe('chunk.iframe.bundle.js')
    expect(developmentPreviewChunkFilename({})).toBe('chunk.iframe.bundle.js')
  })

  it('retains numeric chunk id zero', () => {
    expect(filenameForChunk({ id: 0, name: '' })).toBe('0.iframe.bundle.js')
  })

  it('bounds long filename components', () => {
    const filename = filenameFor(`src-${'deeply-nested-'.repeat(30)}stories`)

    expect(Buffer.byteLength(filename)).toBeLessThanOrEqual(200)
    expect(filename).toMatch(
      /^src-deeply-nested-.*-[a-f0-9]{16}\.iframe\.bundle\.js$/,
    )
  })

  it('gives long names with the same prefix different filenames', () => {
    const prefix = `src-${'same-prefix-'.repeat(30)}`

    expect(filenameFor(`${prefix}first`)).not.toBe(
      filenameFor(`${prefix}second`),
    )
  })

  it('retains the production content hash placeholder', () => {
    expect(filenameFor('preview', true)).toBe(
      'preview.[contenthash:8].iframe.bundle.js',
    )
    expect(filenameFor('x'.repeat(300), true)).toMatch(
      /-[a-f0-9]{16}\.\[contenthash:8\]\.iframe\.bundle\.js$/,
    )
  })

  it('does not change short path-like chunk names', () => {
    expect(filenameFor('src/components/button-stories')).toBe(
      'src/components/button-stories.iframe.bundle.js',
    )
  })

  it('only bounds async chunk filenames and retains production content hashes', async () => {
    const firstBuild = await compile('export default "first";', true)
    const secondBuild = await compile('export default "second";', true)

    expect(firstBuild).toHaveLength(2)
    expect(firstBuild).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^preview\.[a-f0-9]{8}\.iframe\.bundle\.js$/),
        expect.stringMatching(
          /^chunk-.*-[a-f0-9]{16}\.[a-f0-9]{8}\.iframe\.bundle\.js$/,
        ),
      ]),
    )
    expect(firstBuild.every((name) => Buffer.byteLength(name) <= 200)).toBe(
      true,
    )
    expect(secondBuild).not.toEqual(firstBuild)
  })

  it('only bounds async chunk filenames in development', async () => {
    const filenames = await compile('export default "development";', false)

    expect(filenames).toHaveLength(2)
    expect(filenames).toEqual(
      expect.arrayContaining([
        'preview.iframe.bundle.js',
        expect.stringMatching(/^chunk-.*-[a-f0-9]{16}\.iframe\.bundle\.js$/),
      ]),
    )
    expect(filenames.every((name) => Buffer.byteLength(name) <= 200)).toBe(true)
  })
})

import { createFilter } from '@rollup/pluginutils'
import type { RsbuildPlugin } from '@rsbuild/core'
import type { FileParser } from 'react-docgen-typescript'
import type { CompilerOptions, Program } from 'typescript'
import { defaultPropFilter } from './utils/filter'
import type { Options } from './utils/options'

type Filepath = string
type InvalidateModule = () => void
type CloseWatch = () => void

const getDocgen = async (config: Options) => {
  const docGen = await import('react-docgen-typescript')

  const {
    tsconfigPath,
    compilerOptions,
    propFilter = defaultPropFilter,
    setDisplayName,
    typePropName,
    ...rest
  } = config

  const docgenOptions = {
    propFilter,
    ...rest,
  }

  return docGen.withCompilerOptions(
    // Compiler Options are passed in to the custom program.
    {},
    docgenOptions,
  )
}

const startWatch = async (
  config: Options,
  onProgramCreatedOrUpdated: (program: Program) => void,
) => {
  const { default: ts } = await import('typescript')
  const { getTSConfigFile } = await import('./utils/typescript')

  let compilerOptions: CompilerOptions = {
    jsx: ts.JsxEmit.React,
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.Latest,
  }

  const tsconfigPath = config.tsconfigPath ?? './tsconfig.json'

  if (config.compilerOptions) {
    compilerOptions = {
      ...compilerOptions,
      ...config.compilerOptions,
    }
  } else {
    const { options: tsOptions } = getTSConfigFile(tsconfigPath)
    compilerOptions = { ...compilerOptions, ...tsOptions }
  }

  const host = ts.createWatchCompilerHost(
    tsconfigPath,
    compilerOptions,
    ts.sys,
    ts.createSemanticDiagnosticsBuilderProgram,
    undefined,
    () => {
      /* suppress message */
    },
  )
  host.afterProgramCreate = (program) => {
    onProgramCreatedOrUpdated(program.getProgram())
  }

  return new Promise<[Program, CloseWatch]>((resolve) => {
    const watch = ts.createWatchProgram(host)
    resolve([watch.getProgram().getProgram(), watch.close])
  })
}

export default (config: Options = {}): RsbuildPlugin => {
  let tsProgram: Program
  let docGenParser: FileParser
  // prettier-ignore
  let generateDocgenCodeBlock: typeof import(
    "./utils/generate"
  )["generateDocgenCodeBlock"]
  let generateOptions: ReturnType<
    (typeof import('./utils/options'))['getGenerateOptions']
  >
  let filter: ReturnType<typeof createFilter>
  const moduleInvalidationQueue: Map<Filepath, InvalidateModule> = new Map()
  let closeWatch: CloseWatch

  return {
    name: 'rsbuild-plugin-react-docgen-typescript',
    setup(api) {
      api.modifyRsbuildConfig(async () => {
        const { getGenerateOptions } = await import('./utils/options')
        generateDocgenCodeBlock = (await import('./utils/generate'))
          .generateDocgenCodeBlock

        docGenParser = await getDocgen(config)
        generateOptions = getGenerateOptions(config)
        ;[tsProgram, closeWatch] = await startWatch(config, (program) => {
          tsProgram = program

          for (const [
            filepath,
            invalidateModule,
          ] of moduleInvalidationQueue.entries()) {
            invalidateModule()
            moduleInvalidationQueue.delete(filepath)
          }
        })

        filter = createFilter(
          config.include ?? ['**/**.tsx'],
          config.exclude ?? ['**/**.stories.tsx'],
        )
      })

      api.transform(
        {
          test: (id) => {
            return filter(id)
          },
        },
        async ({ code: src, resource: id }) => {
          try {
            const componentDocs = docGenParser.parseWithProgramProvider(
              id,
              () => tsProgram,
            )

            if (!componentDocs.length) {
              return { code: src }
            }

            const res = generateDocgenCodeBlock({
              filename: id,
              source: src,
              componentDocs,
              ...generateOptions,
            })

            return res
          } catch (_e) {
            return src
          }
        },
      )

      api.onCloseBuild(() => {
        closeWatch()
      })
    },
  }
}

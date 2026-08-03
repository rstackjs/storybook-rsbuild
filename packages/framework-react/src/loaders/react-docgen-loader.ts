/**
 * Code taken from https://github.com/storybookjs/storybook/tree/next/code/presets/react-webpack/src/loaders
 */

import findUp from 'find-up'
import MagicString from 'magic-string'
import type {
  Documentation,
  Handler,
  NodePath,
  babelTypes as t,
} from 'react-docgen'
import {
  builtinHandlers as docgenHandlers,
  builtinResolvers as docgenResolver,
  ERROR_CODES,
  makeFsImporter,
  parse,
  utils,
} from 'react-docgen'
import { logger } from 'storybook/internal/node-logger'
import * as TsconfigPaths from 'tsconfig-paths'
// @ts-expect-error can not reexport `LoaderContext` from @rsbuild/core
import type { LoaderContext } from 'webpack'

import {
  defaultLookupModule,
  RESOLVE_EXTENSIONS,
  ReactDocgenResolveError,
} from './docgen-resolver'

const { getNameOrValue, isReactForwardRefCall } = utils

const actualNameHandler: Handler = function actualNameHandler(
  documentation,
  componentDefinition,
) {
  documentation.set('definedInFile', componentDefinition.hub.file.opts.filename)
  if (
    (componentDefinition.isClassDeclaration() ||
      componentDefinition.isFunctionDeclaration()) &&
    componentDefinition.has('id')
  ) {
    documentation.set(
      'actualName',
      getNameOrValue(componentDefinition.get('id') as NodePath<t.Identifier>),
    )
  } else if (
    componentDefinition.isArrowFunctionExpression() ||
    componentDefinition.isFunctionExpression() ||
    isReactForwardRefCall(componentDefinition)
  ) {
    let currentPath: NodePath = componentDefinition

    while (currentPath.parentPath) {
      if (currentPath.parentPath.isVariableDeclarator()) {
        documentation.set(
          'actualName',
          getNameOrValue(currentPath.parentPath.get('id')),
        )
        return
      }
      if (currentPath.parentPath.isAssignmentExpression()) {
        const leftPath = currentPath.parentPath.get('left')

        if (leftPath.isIdentifier() || leftPath.isLiteral()) {
          documentation.set('actualName', getNameOrValue(leftPath))
          return
        }
      }

      currentPath = currentPath.parentPath
    }
    // Could not find an actual name
    documentation.set('actualName', '')
  }
}

type DocObj = Documentation & { actualName: string; definedInFile: string }

const defaultHandlers = Object.values(docgenHandlers).map((handler) => handler)
const defaultResolver = new docgenResolver.FindExportedDefinitionsResolver()
const handlers = [...defaultHandlers, actualNameHandler]

let tsconfigPathsInitializeStatus:
  | 'uninitialized'
  | 'initializing'
  | 'initialized' = 'uninitialized'

let resolveTsconfigPathsInitialingPromise: (
  value: void | PromiseLike<void>,
) => void
const tsconfigPathsInitialingPromise = new Promise<void>((resolve) => {
  resolveTsconfigPathsInitialingPromise = resolve
})

const finishInitialization = () => {
  resolveTsconfigPathsInitialingPromise()
  tsconfigPathsInitializeStatus = 'initialized'
}

let matchPath: TsconfigPaths.MatchPath | undefined

/**
 * Tsconfig filenames to try, in order.
 *
 * @see https://github.com/storybookjs/storybook/blob/3e12dfc040/code/presets/react-webpack/src/loaders/react-docgen-loader.ts#L86-L89
 */
const TSCONFIG_CANDIDATES = [
  'tsconfig.json',
  'tsconfig.base.json',
  'tsconfig.app.json',
] as const

const findTsconfigPath = async (cwd: string): Promise<string | undefined> => {
  for (const candidate of TSCONFIG_CANDIDATES) {
    const found = await findUp(candidate, { cwd })
    if (found) {
      return found
    }
  }

  return undefined
}

export default async function reactDocgenLoader(
  this: LoaderContext<{ debug: boolean }>,
  source: string,
  map: any,
) {
  const callback = this.async()
  // get options
  const options = this.getOptions() || {}
  const { debug = false } = options

  if (tsconfigPathsInitializeStatus === 'uninitialized') {
    tsconfigPathsInitializeStatus = 'initializing'
    const tsconfigPath = await findTsconfigPath(process.cwd())
    const tsconfig = TsconfigPaths.loadConfig(tsconfigPath)

    if (tsconfig.resultType === 'success') {
      logger.info('Using tsconfig paths for react-docgen')
      matchPath = TsconfigPaths.createMatchPath(
        tsconfig.absoluteBaseUrl,
        tsconfig.paths,
        ['browser', 'module', 'main'],
      )
    }

    finishInitialization()
  }

  if (tsconfigPathsInitializeStatus === 'initializing') {
    await tsconfigPathsInitialingPromise
  }

  try {
    const docgenResults = parse(source, {
      filename: this.resourcePath,
      resolver: defaultResolver,
      handlers,
      importer: getReactDocgenImporter(matchPath),
      babelOptions: {
        babelrc: false,
        configFile: false,
      },
    }) as DocObj[]

    const magicString = new MagicString(source)

    for (const info of docgenResults) {
      const { actualName, definedInFile, ...docgenInfo } = info
      if (actualName && definedInFile === this.resourcePath) {
        const docNode = JSON.stringify(docgenInfo)
        magicString.append(`;${actualName}.__docgenInfo=${docNode}`)
      }
    }

    callback(
      null,
      magicString.toString(),
      map ??
        magicString.generateMap({
          hires: true,
          source: this.resourcePath,
          includeContent: true,
        }),
    )
  } catch (error: any) {
    if (error.code === ERROR_CODES.MISSING_DEFINITION) {
      callback(null, source)
    } else {
      if (!debug) {
        logger.warn(
          `Failed to parse ${this.resourcePath} with react-docgen. Rerun Storybook with --loglevel=debug to get more info.`,
        )
      } else {
        logger.warn(
          `Failed to parse ${this.resourcePath} with react-docgen. Please use the below error message and the content of the file which causes the error to report the issue to the maintainers of react-docgen. https://github.com/reactjs/react-docgen`,
        )
        logger.error(error)
      }

      callback(null, source)
    }
  }
}

export function getReactDocgenImporter(
  matchingPath: TsconfigPaths.MatchPath | undefined,
) {
  return makeFsImporter((filename, basedir) => {
    const mappedFilenameByPaths = (() => {
      if (matchingPath) {
        const match = matchingPath(filename)
        return match || filename
      }
      return filename
    })()

    const result = defaultLookupModule(mappedFilenameByPaths, basedir)

    if (RESOLVE_EXTENSIONS.find((ext) => result.endsWith(ext))) {
      return result
    }

    throw new ReactDocgenResolveError(filename)
  })
}

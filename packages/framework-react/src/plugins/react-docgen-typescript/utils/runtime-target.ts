/**
 * Ported from @joshwooding/vite-plugin-react-docgen-typescript@0.9.0
 * (tag commit 6f7e7cf2f8c61ad3e83bcbd3aec4f85029798089), MIT license.
 *
 * Sources:
 * - packages/vite-plugin-react-docgen-typescript/src/utils/runtimeTarget.ts
 * - packages/vite-plugin-react-docgen-typescript/src/docgen/runtimeTarget.ts
 *
 * Local adjustments: the two files are merged (the `../docgen/runtimeTarget`
 * import is inlined) and formatted for this repo. The logic is unchanged.
 */

import path from 'node:path'
import type { ComponentDoc } from 'react-docgen-typescript'
import type * as ts from 'typescript'

type TsModule = typeof import('typescript')

export interface ComponentDocWithTarget extends ComponentDoc {
  targetExpression: string | null
}

const IDENTIFIER_PATH_PATTERN = /^[$A-Z_a-z][$\w]*(?:\.[$A-Z_a-z][$\w]*)*$/
const RESERVED_RUNTIME_TARGET_ROOTS: ReadonlySet<string> = new Set([
  'arguments',
  'await',
  'break',
  'case',
  'catch',
  'class',
  'const',
  'continue',
  'debugger',
  'default',
  'delete',
  'do',
  'else',
  'enum',
  'eval',
  'export',
  'extends',
  'false',
  'finally',
  'for',
  'function',
  'if',
  'implements',
  'import',
  'in',
  'instanceof',
  'interface',
  'let',
  'new',
  'null',
  'package',
  'private',
  'protected',
  'public',
  'return',
  'static',
  'super',
  'switch',
  'this',
  'throw',
  'true',
  'try',
  'typeof',
  'var',
  'void',
  'while',
  'with',
  'yield',
])

export const isSupportedRuntimeTargetExpression = (value: string): boolean => {
  if (!IDENTIFIER_PATH_PATTERN.test(value)) return false
  const [root] = value.split('.', 1)
  return Boolean(root && !RESERVED_RUNTIME_TARGET_ROOTS.has(root))
}

const getNodeModifiers = (node: ts.Node) =>
  'modifiers' in node
    ? (
        node as ts.Node & {
          modifiers?: ts.NodeArray<ts.Modifier>
        }
      ).modifiers
    : undefined

const hasModifier = (node: ts.Node, modifierKind: ts.SyntaxKind): boolean =>
  Boolean(
    getNodeModifiers(node)?.some((modifier) => modifier.kind === modifierKind),
  )

const getExpressionTargetText = (
  expression: ts.Expression,
  sourceFile: ts.SourceFile,
  tsModule: TsModule,
): string | null => {
  if (tsModule.isIdentifier(expression)) {
    return expression.text
  }

  if (tsModule.isPropertyAccessExpression(expression)) {
    const targetExpression = expression.getText(sourceFile)
    return isSupportedRuntimeTargetExpression(targetExpression)
      ? targetExpression
      : null
  }

  return null
}

const getDeclarationTarget = (
  declaration: ts.Declaration,
  sourceFile: ts.SourceFile,
  tsModule: TsModule,
): string | null => {
  if (
    tsModule.isVariableDeclaration(declaration) &&
    tsModule.isIdentifier(declaration.name)
  ) {
    return declaration.name.text
  }

  if (
    (tsModule.isFunctionDeclaration(declaration) ||
      tsModule.isClassDeclaration(declaration)) &&
    declaration.name
  ) {
    return declaration.name.text
  }

  if (tsModule.isExportAssignment(declaration)) {
    return getExpressionTargetText(declaration.expression, sourceFile, tsModule)
  }

  if (tsModule.isExportSpecifier(declaration)) {
    const exportDeclaration = declaration.parent.parent

    if (
      tsModule.isExportDeclaration(exportDeclaration) &&
      exportDeclaration.getSourceFile() === sourceFile &&
      !exportDeclaration.moduleSpecifier
    ) {
      return declaration.propertyName?.text ?? declaration.name.text
    }
  }

  return null
}

const getTargetFromSymbol = (
  symbol: ts.Symbol,
  checker: ts.TypeChecker,
  sourceFile: ts.SourceFile,
  tsModule: TsModule,
): string | null => {
  const candidateSymbols = [symbol]

  if (symbol.flags & tsModule.SymbolFlags.Alias) {
    try {
      candidateSymbols.unshift(checker.getAliasedSymbol(symbol))
    } catch {
      // Fall back to the original symbol when alias resolution is not possible.
    }
  }

  for (const candidateSymbol of candidateSymbols) {
    const declarations =
      candidateSymbol.declarations ??
      (candidateSymbol.valueDeclaration
        ? [candidateSymbol.valueDeclaration]
        : [])

    for (const declaration of declarations) {
      if (declaration.getSourceFile() !== sourceFile) {
        continue
      }

      const targetExpression = getDeclarationTarget(
        declaration,
        sourceFile,
        tsModule,
      )

      if (
        targetExpression &&
        isSupportedRuntimeTargetExpression(targetExpression)
      ) {
        return targetExpression
      }
    }
  }

  return null
}

const getDeclarationStatementTarget = (
  statement: ts.Statement,
  tsModule: TsModule,
): string[] => {
  if (tsModule.isVariableStatement(statement)) {
    const targets: string[] = []

    for (const declaration of statement.declarationList.declarations) {
      if (tsModule.isIdentifier(declaration.name)) {
        targets.push(declaration.name.text)
      }
    }

    return targets
  }

  if (
    (tsModule.isFunctionDeclaration(statement) ||
      tsModule.isClassDeclaration(statement)) &&
    statement.name
  ) {
    return [statement.name.text]
  }

  return []
}

const getNamedExportTargets = (
  sourceFile: ts.SourceFile,
  tsModule: TsModule,
): Set<string> => {
  const namedExportTargets = new Set<string>()

  for (const statement of sourceFile.statements) {
    if (
      hasModifier(statement, tsModule.SyntaxKind.ExportKeyword) &&
      !hasModifier(statement, tsModule.SyntaxKind.DefaultKeyword)
    ) {
      getDeclarationStatementTarget(statement, tsModule).forEach((target) => {
        namedExportTargets.add(target)
      })
    }

    if (
      tsModule.isExportDeclaration(statement) &&
      statement.exportClause &&
      tsModule.isNamedExports(statement.exportClause) &&
      !statement.moduleSpecifier
    ) {
      statement.exportClause.elements.forEach((element) => {
        if (element.name.text === 'default') {
          return
        }

        namedExportTargets.add(element.propertyName?.text ?? element.name.text)
      })
    }
  }

  return namedExportTargets
}

const getDefaultExportTarget = (
  sourceFile: ts.SourceFile,
  tsModule: TsModule,
): string | null => {
  for (const statement of sourceFile.statements) {
    if (tsModule.isExportAssignment(statement)) {
      return getExpressionTargetText(statement.expression, sourceFile, tsModule)
    }

    if (
      (tsModule.isFunctionDeclaration(statement) ||
        tsModule.isClassDeclaration(statement)) &&
      hasModifier(statement, tsModule.SyntaxKind.ExportKeyword) &&
      hasModifier(statement, tsModule.SyntaxKind.DefaultKeyword) &&
      statement.name
    ) {
      return statement.name.text
    }

    if (
      tsModule.isExportDeclaration(statement) &&
      statement.exportClause &&
      tsModule.isNamedExports(statement.exportClause) &&
      !statement.moduleSpecifier
    ) {
      const defaultSpecifier = statement.exportClause.elements.find(
        (element) => element.name.text === 'default',
      )

      if (defaultSpecifier) {
        return defaultSpecifier.propertyName?.text ?? defaultSpecifier.name.text
      }
    }
  }

  return null
}

const getDefaultExportDisplayName = (fileName: string): string => {
  const basename = path.basename(fileName, path.extname(fileName))
  const normalizedBasename =
    basename === 'index' ? path.basename(path.dirname(fileName)) : basename
  const identifier = normalizedBasename
    .replace(/^[^A-Z]*/gi, '')
    .replace(/[^A-Z0-9]*/gi, '')

  return identifier.length ? identifier : 'DefaultName'
}

const resolveTargetExpression = (
  componentDoc: ComponentDoc,
  checker: ts.TypeChecker,
  sourceFile: ts.SourceFile,
  namedExportTargets: Set<string>,
  tsModule: TsModule,
): string | null => {
  if (componentDoc.expression) {
    const targetFromExpression = getTargetFromSymbol(
      componentDoc.expression,
      checker,
      sourceFile,
      tsModule,
    )

    if (targetFromExpression) {
      return targetFromExpression
    }
  }

  if (namedExportTargets.has(componentDoc.displayName)) {
    return componentDoc.displayName
  }

  if (
    componentDoc.displayName.includes('.') &&
    isSupportedRuntimeTargetExpression(componentDoc.displayName)
  ) {
    return componentDoc.displayName
  }

  return null
}

export function resolveComponentDocRuntimeTargets(
  componentDocs: ComponentDoc[],
  checker: ts.TypeChecker,
  sourceFile: ts.SourceFile,
  tsModule: TsModule,
): ComponentDocWithTarget[] {
  const namedExportTargets = getNamedExportTargets(sourceFile, tsModule)
  const defaultExportTarget = getDefaultExportTarget(sourceFile, tsModule)
  const defaultExportDisplayName = getDefaultExportDisplayName(
    sourceFile.fileName,
  )
  const usedTargets = new Set<string>()

  const resolvedComponentDocs = componentDocs.map((componentDoc) => {
    const targetExpression = resolveTargetExpression(
      componentDoc,
      checker,
      sourceFile,
      namedExportTargets,
      tsModule,
    )

    if (targetExpression) {
      usedTargets.add(targetExpression)
    }

    return {
      ...componentDoc,
      targetExpression,
    }
  })

  if (!defaultExportTarget || usedTargets.has(defaultExportTarget)) {
    return resolvedComponentDocs
  }

  const unresolvedDocs = resolvedComponentDocs.filter(
    (componentDoc) => !componentDoc.targetExpression,
  )

  const defaultExportDoc =
    unresolvedDocs.find(
      (componentDoc) => componentDoc.displayName === defaultExportDisplayName,
    ) ?? (unresolvedDocs.length === 1 ? unresolvedDocs[0] : undefined)

  if (defaultExportDoc) {
    defaultExportDoc.targetExpression = defaultExportTarget
  }

  return resolvedComponentDocs
}

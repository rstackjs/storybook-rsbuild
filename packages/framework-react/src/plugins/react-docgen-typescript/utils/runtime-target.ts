/**
 * Ported from @joshwooding/vite-plugin-react-docgen-typescript@0.9.0
 * (tag commit 6f7e7cf2f8c61ad3e83bcbd3aec4f85029798089), MIT license.
 *
 * Sources:
 * - packages/vite-plugin-react-docgen-typescript/src/utils/runtimeTarget.ts
 * - packages/vite-plugin-react-docgen-typescript/src/docgen/runtimeTarget.ts
 *
 * Local adjustments: the two files are merged (the `../docgen/runtimeTarget`
 * import is inlined), formatted for this repo, and the default-export display
 * name comes from react-docgen-typescript's `getDefaultExportForFile` instead of
 * upstream's local copy, which mis-handles dotted filenames such as
 * `Button.styles.tsx`. Target resolution also diverges locally: namespace
 * members are qualified and must be reachable at module scope, destructured
 * bindings and shorthand/property assignments resolve through their symbols,
 * and runtime targets accept Unicode identifiers. The rest is unchanged.
 */

import type { ComponentDoc } from 'react-docgen-typescript'
import { getDefaultExportForFile } from 'react-docgen-typescript'
import type * as ts from 'typescript'

type TsModule = typeof import('typescript')

export interface ComponentDocWithTarget extends ComponentDoc {
  targetExpression: string | null
}

const IDENTIFIER_PATH_PATTERN =
  /^[$_\p{ID_Start}][$\u200C\u200D\p{ID_Continue}]*(?:\.[$_\p{ID_Start}][$\u200C\u200D\p{ID_Continue}]*)*$/u
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

const getDeclarationName = (
  declaration: ts.Declaration,
  tsModule: TsModule,
): { declaration: ts.Declaration; name: string } | null => {
  if (
    (tsModule.isArrowFunction(declaration) ||
      tsModule.isFunctionExpression(declaration) ||
      tsModule.isClassExpression(declaration)) &&
    tsModule.isVariableDeclaration(declaration.parent) &&
    tsModule.isIdentifier(declaration.parent.name)
  ) {
    return {
      declaration: declaration.parent,
      name: declaration.parent.name.text,
    }
  }

  if (
    tsModule.isVariableDeclaration(declaration) &&
    tsModule.isIdentifier(declaration.name)
  ) {
    return { declaration, name: declaration.name.text }
  }

  if (
    (tsModule.isFunctionDeclaration(declaration) ||
      tsModule.isClassDeclaration(declaration)) &&
    declaration.name
  ) {
    return { declaration, name: declaration.name.text }
  }

  if (
    tsModule.isBindingElement(declaration) &&
    tsModule.isIdentifier(declaration.name)
  ) {
    return { declaration, name: declaration.name.text }
  }

  return null
}

const getEnclosingVariableStatement = (
  node: ts.Node,
  tsModule: TsModule,
): ts.VariableStatement | undefined => {
  let current: ts.Node | undefined = node

  while (current) {
    if (tsModule.isVariableStatement(current)) {
      return current
    }
    if (tsModule.isSourceFile(current) || tsModule.isModuleBlock(current)) {
      return undefined
    }
    current = current.parent
  }

  return undefined
}

const isExportedDeclaration = (
  declaration: ts.Declaration,
  tsModule: TsModule,
): boolean => {
  if (
    tsModule.isFunctionDeclaration(declaration) ||
    tsModule.isClassDeclaration(declaration)
  ) {
    return hasModifier(declaration, tsModule.SyntaxKind.ExportKeyword)
  }

  const statement = getEnclosingVariableStatement(declaration, tsModule)
  return Boolean(
    statement && hasModifier(statement, tsModule.SyntaxKind.ExportKeyword),
  )
}

/**
 * Enclosing namespace path (outermost first) when the declaration is reachable
 * at module scope, or null for function/block scopes and non-exported namespace
 * members.
 */
const getModuleScopePath = (
  declaration: ts.Declaration,
  tsModule: TsModule,
): string[] | null => {
  const namespacePath: string[] = []
  let node: ts.Node = declaration

  while (node.parent) {
    const parent = node.parent

    if (tsModule.isSourceFile(parent)) {
      if (
        namespacePath.length > 0 &&
        !isExportedDeclaration(declaration, tsModule)
      ) {
        return null
      }
      return namespacePath.reverse()
    }

    if (tsModule.isModuleBlock(parent)) {
      const moduleDeclaration = parent.parent
      if (
        !tsModule.isModuleDeclaration(moduleDeclaration) ||
        !tsModule.isIdentifier(moduleDeclaration.name) ||
        !hasModifier(moduleDeclaration, tsModule.SyntaxKind.ExportKeyword)
      ) {
        return null
      }
      namespacePath.push(moduleDeclaration.name.text)
      node = moduleDeclaration
      continue
    }

    if (
      tsModule.isVariableDeclaration(parent) ||
      tsModule.isVariableDeclarationList(parent) ||
      tsModule.isVariableStatement(parent) ||
      tsModule.isObjectBindingPattern(parent) ||
      tsModule.isArrayBindingPattern(parent)
    ) {
      node = parent
      continue
    }

    // Function body, block, class body, etc. — not module scope.
    return null
  }

  return null
}

const getDeclarationTarget = (
  declaration: ts.Declaration,
  sourceFile: ts.SourceFile,
  tsModule: TsModule,
): string | null => {
  const named = getDeclarationName(declaration, tsModule)

  if (named) {
    const namespacePath = getModuleScopePath(named.declaration, tsModule)
    if (!namespacePath) {
      return null
    }
    return [...namespacePath, named.name].join('.')
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
  seen: Set<ts.Symbol> = new Set(),
): string | null => {
  if (seen.has(symbol)) {
    return null
  }
  seen.add(symbol)

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

      if (tsModule.isShorthandPropertyAssignment(declaration)) {
        const valueSymbol =
          checker.getShorthandAssignmentValueSymbol(declaration)
        const target = valueSymbol
          ? getTargetFromSymbol(
              valueSymbol,
              checker,
              sourceFile,
              tsModule,
              seen,
            )
          : null
        if (target) {
          return target
        }
        continue
      }

      if (
        tsModule.isPropertyAssignment(declaration) &&
        tsModule.isIdentifier(declaration.initializer)
      ) {
        const valueSymbol = checker.getSymbolAtLocation(declaration.initializer)
        const target = valueSymbol
          ? getTargetFromSymbol(
              valueSymbol,
              checker,
              sourceFile,
              tsModule,
              seen,
            )
          : null
        if (target) {
          return target
        }
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

const collectBindingTargets = (
  name: ts.BindingName,
  tsModule: TsModule,
  targets: string[],
): void => {
  if (tsModule.isIdentifier(name)) {
    targets.push(name.text)
    return
  }

  for (const element of name.elements) {
    if (tsModule.isBindingElement(element)) {
      collectBindingTargets(element.name, tsModule, targets)
    }
  }
}

const getDeclarationStatementTarget = (
  statement: ts.Statement,
  tsModule: TsModule,
): string[] => {
  if (tsModule.isVariableStatement(statement)) {
    const targets: string[] = []

    for (const declaration of statement.declarationList.declarations) {
      collectBindingTargets(declaration.name, tsModule, targets)
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
  const defaultExportDisplayName = getDefaultExportForFile(sourceFile)
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

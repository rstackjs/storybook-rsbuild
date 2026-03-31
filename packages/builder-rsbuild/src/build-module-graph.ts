import type { Rspack } from '@rsbuild/core'
import type { ModuleGraph, ModuleNode } from './types'

type CompilationLike = Pick<Rspack.Compilation, 'modules' | 'moduleGraph'>
type RspackModule = Rspack.Module

const getModuleFile = (module: RspackModule): string | undefined =>
  module.nameForCondition()

const getModuleType = (module: RspackModule): ModuleNode['type'] => {
  if (module.type.startsWith('css')) {
    return 'css'
  }

  if (module.type.startsWith('asset')) {
    return 'asset'
  }

  return 'js'
}

export function buildModuleGraph(compilation: CompilationLike): ModuleGraph {
  const moduleGraph: ModuleGraph = new Map()
  const moduleNodeMap = new WeakMap<object, ModuleNode>()

  const getOrCreateModuleNode = (
    module: RspackModule | null | undefined,
  ): ModuleNode | undefined => {
    if (!module) {
      return undefined
    }

    const file = getModuleFile(module)
    if (!file) {
      return undefined
    }

    const existingNode = moduleNodeMap.get(module)
    if (existingNode) {
      return existingNode
    }

    const moduleNode: ModuleNode = {
      file,
      type: getModuleType(module),
      importers: new Set(),
      importedModules: new Set(),
    }
    moduleNodeMap.set(module, moduleNode)

    const moduleSet = moduleGraph.get(file) ?? new Set<ModuleNode>()
    moduleSet.add(moduleNode)
    moduleGraph.set(file, moduleSet)

    return moduleNode
  }

  for (const module of compilation.modules) {
    getOrCreateModuleNode(module)
  }

  for (const module of compilation.modules) {
    const moduleNode = getOrCreateModuleNode(module)
    if (!moduleNode) {
      continue
    }

    for (const connection of compilation.moduleGraph.getIncomingConnections(
      module,
    )) {
      const importerNode = getOrCreateModuleNode(connection.originModule)
      if (importerNode) {
        moduleNode.importers.add(importerNode)
        importerNode.importedModules.add(moduleNode)
      }
    }
  }

  return moduleGraph
}

export function mergeModuleGraphs(graphs: ModuleGraph[]): ModuleGraph {
  const mergedGraph: ModuleGraph = new Map()

  for (const graph of graphs) {
    for (const [file, nodes] of graph.entries()) {
      const mergedNodes = mergedGraph.get(file) ?? new Set<ModuleNode>()
      for (const node of nodes) {
        mergedNodes.add(node)
      }
      mergedGraph.set(file, mergedNodes)
    }
  }

  return mergedGraph
}

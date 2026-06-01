import * as nodePath from 'node:path'
// `node:test` is a `node:`-only builtin with NO bare-name counterpart in
// `builtinModules` — plain scheme-stripping would turn it into "Can't resolve
// 'test'" and break the whole build. StripNodeProtocolPlugin routes it to the
// empty shim instead.
import * as nodeTest from 'node:test'
import type { Meta, StoryObj } from 'storybook-next-rsbuild'

// Regression target: transitive deps in browser bundles often carry `node:`-
// prefixed imports (server-only code paths). The ES imports are evaluated when
// this chunk loads, so if `node:*` is not handled the chunk throws e.g.
// "Cannot find module 'node:path'" before render. StripNodeProtocolPlugin
// normalizes them to empty modules: symbols become `undefined` and the story
// still renders.
function NodeProtocolProbe() {
  const sep = (nodePath as { sep?: string }).sep ?? '<empty>'
  const hasTest = typeof (nodeTest as { test?: unknown }).test
  return (
    <div data-testid="node-protocol-probe">
      node:path sep = {sep} / node:test = {hasTest}
    </div>
  )
}

const meta = {
  component: NodeProtocolProbe,
} satisfies Meta<typeof NodeProtocolProbe>

export default meta

export const Default: StoryObj<typeof meta> = {}

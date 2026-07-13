import * as nodePath from 'node:path'
// `node:test` has no bare-name counterpart — exercises the empty-shim branch
// of StripNodeProtocolPlugin (vs `node:path` which falls back to bare).
import * as nodeTest from 'node:test'
import type { Meta, StoryObj } from 'storybook-next-rsbuild'

// Regression target for `node:`-prefixed imports in browser bundles: the story
// renders only if StripNodeProtocolPlugin normalizes them to empty modules.
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

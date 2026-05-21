// biome-ignore lint/style/useNodejsImportProtocol: legacy bare specifier is the regression target
import { Buffer as BufferImported } from 'buffer'
// biome-ignore lint/style/useNodejsImportProtocol: legacy bare specifier is the regression target
import qs from 'querystring'
import type { Meta, StoryObj } from 'storybook-next-rsbuild'

// `Buffer` referenced bare — relies on Next.js's ProvidePlugin being kept.
declare const Buffer: { from(s: string): { toString(enc: string): string } }

function PolyfillProbe() {
  const parsed = qs.parse('a=1&b=2')
  const encoded = BufferImported.from('hi').toString('base64')
  const provided = Buffer.from('hi').toString('base64')
  return (
    <pre data-testid="polyfill-output">
      {JSON.stringify({ parsed, encoded, provided })}
    </pre>
  )
}

const meta = { component: PolyfillProbe } satisfies Meta<typeof PolyfillProbe>

export default meta

export const NodePolyfills: StoryObj<typeof meta> = {}

// Bare specifiers (no `node:` prefix) are intentional: this story exists to
// verify Next.js's per-rule `resolve.fallback` is harvested into the global
// fallback so userland code that imports Node builtins the legacy way still
// resolves to the browser polyfill. The `node:` prefix bypasses that path.
// biome-ignore lint/style/useNodejsImportProtocol: see comment above
import { Buffer } from 'buffer'
// biome-ignore lint/style/useNodejsImportProtocol: see comment above
import qs from 'querystring'
import type { Meta, StoryObj } from 'storybook-next-rsbuild'

// Exercises Next.js's per-rule resolve.fallback for Node.js core modules.
// Regression target: utils/next-config.ts harvestFallback() — if the global
// fallback floor is missed, querystring/buffer become {} stubs and the runtime
// throws `qs.parse is not a function`.
function PolyfillProbe() {
  const parsed = qs.parse('a=1&b=2')
  const encoded = Buffer.from('hi').toString('base64')
  return (
    <pre data-testid="polyfill-output">
      {JSON.stringify({ parsed, encoded })}
    </pre>
  )
}

const meta = { component: PolyfillProbe } satisfies Meta<typeof PolyfillProbe>

export default meta

export const NodePolyfills: StoryObj<typeof meta> = {}

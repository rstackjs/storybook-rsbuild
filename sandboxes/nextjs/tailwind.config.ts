import type { Config } from 'tailwindcss'

// `preflight: false` so Tailwind's global reset does not alter the other
// sandbox stories — this config only needs `@tailwind utilities` to expand.
export default {
  content: ['./src/**/*.{ts,tsx}'],
  corePlugins: { preflight: false },
} satisfies Config

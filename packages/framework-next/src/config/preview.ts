// Port: @storybook/nextjs-vite/src/config/preview.ts
// Legacy `next/config` annotation for Next.js < 16 (gated in preset.ts).
// @ts-expect-error — `next/config` removed from package exports in Next.js 16
import { setConfig } from 'next/config'

setConfig(process.env.__NEXT_RUNTIME_CONFIG as unknown as object)

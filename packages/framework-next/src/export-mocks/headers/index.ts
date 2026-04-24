// Port: @storybook/nextjs-vite/src/export-mocks/headers/index.ts
import * as headers from 'next/dist/server/request/headers.js'
import { fn } from 'storybook/test'
import { draftMode as originalDraftMode } from '../../next-internals'

// re-exports of the actual module
export * from 'next/dist/server/request/headers.js'
export { cookies } from './cookies'
// mock utilities/overrides
export { headers } from './headers'

// passthrough mocks - keep original implementation but allow for spying
const draftMode = fn(originalDraftMode ?? (headers as any).draftMode).mockName(
  'draftMode',
)

export { draftMode }

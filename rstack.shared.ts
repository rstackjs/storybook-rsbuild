import { fileURLToPath } from 'node:url'
import type { RstackConfig } from 'rstack'

// Shared by every Rstest project listed in the root `rstack.config.ts`
// `define.test({ projects })`. Mirrors the old `rstestCommonConfig` defaults.
export const sharedConfig: RstackConfig = {
  test: {
    passWithNoTests: true,
    clearMocks: true,
    globals: true,
    testTimeout: 10000,
    testEnvironment: 'node',
    include: ['**/*.test.{ts,tsx}'],
  },
}

// The setup file replaces console.warn/error with throwing spies, so only the
// projects that opted into it before enable this config. Paths are absolute
// because a shared config is not resolved relative to its own module.
export const sharedConfigWithSetup: RstackConfig = {
  extends: [sharedConfig],
  test: {
    setupFiles: [fileURLToPath(new URL('./rstest-setup.ts', import.meta.url))],
  },
}

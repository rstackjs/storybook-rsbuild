import { createElement, type ReactNode } from 'react'
import { frameStyle } from './theme'

// Only reachable through the preview of each config dir. Written with
// `createElement` (no JSX) on purpose: JSX in the default `.storybook/` preview
// graph was observed to change the shape of the stats, see tests/turbosnap.test.ts.
export const withFrame = (Story: () => ReactNode) =>
  createElement('div', { style: frameStyle }, Story())

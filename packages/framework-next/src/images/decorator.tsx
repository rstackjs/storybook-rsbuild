// Port: @storybook/nextjs-vite/src/images/decorator.tsx
// Note: uses `ImageConfigContext` directly instead of the upstream `sb-original/image-context` proxy.
import * as React from 'react'
import type { Addon_StoryContext } from 'storybook/internal/types'
import { ImageConfigContext } from '../next-internals'

export const ImageDecorator = (
  Story: React.FC,
  { parameters }: Addon_StoryContext,
): React.ReactNode => {
  if (!parameters.nextjs?.image) {
    return <Story />
  }

  return (
    <ImageConfigContext.Provider value={parameters.nextjs.image}>
      <Story />
    </ImageConfigContext.Provider>
  )
}

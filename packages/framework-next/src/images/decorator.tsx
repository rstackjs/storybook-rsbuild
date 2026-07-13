// Port: @storybook/nextjs-vite/src/images/decorator.tsx
import * as React from 'react'
import type { Addon_StoryContext } from 'storybook/internal/types'
// Shared with the next/image mock via the package's own `./image-context`
// export, so provider and consumer resolve to ONE context identity. The
// specifier is externalized at build time (scripts/build entry-utils lists the
// package name), so it is not inlined into a second copy here.
import { ImageContext } from 'storybook-next-rsbuild/image-context'

export const ImageDecorator = (
  Story: React.FC,
  { parameters }: Addon_StoryContext,
): React.ReactNode => {
  if (!parameters.nextjs?.image) {
    return <Story />
  }

  return (
    <ImageContext.Provider value={parameters.nextjs.image}>
      <Story />
    </ImageContext.Provider>
  )
}

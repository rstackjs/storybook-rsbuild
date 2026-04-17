// Port: @storybook/nextjs-vite/src/head-manager/decorator.tsx
import * as React from 'react'

import HeadManagerProvider from './head-manager-provider'

export const HeadManagerDecorator = (Story: React.FC): React.ReactNode => {
  return (
    <HeadManagerProvider>
      <Story />
    </HeadManagerProvider>
  )
}

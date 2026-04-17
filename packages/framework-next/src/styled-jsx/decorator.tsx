// Port: @storybook/nextjs-vite/src/styledJsx/decorator.tsx
// Note: upstream directory is `styledJsx`; renamed here to `styled-jsx` for kebab-case consistency.
import * as React from 'react'

import { StyleRegistry } from 'styled-jsx'

export const StyledJsxDecorator = (Story: React.FC): React.ReactNode => (
  <StyleRegistry>
    <Story />
  </StyleRegistry>
)

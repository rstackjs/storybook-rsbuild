import { root } from '@lynx-js/react'

import { Button } from './components/Button.tsx'

root.render(<Button label="Click me" primary />)

if (import.meta.webpackHot) {
  import.meta.webpackHot.accept()
}

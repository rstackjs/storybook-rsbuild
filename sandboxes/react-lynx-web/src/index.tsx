import { root } from '@lynx-js/react'

import { Button } from './components/Button.tsx'

root.render(<Button />)

if (import.meta.webpackHot) {
  import.meta.webpackHot.accept()
}

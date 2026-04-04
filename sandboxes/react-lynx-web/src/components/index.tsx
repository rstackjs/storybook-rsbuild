import { root } from '@lynx-js/react'

import { Button } from './Button.tsx'
import './Button.css'

root.render(<Button />)

if (import.meta.webpackHot) {
  import.meta.webpackHot.accept()
}

import type { ReactNode } from 'react'
import { withFrame } from '../src/decorators'

// Second config dir (built to `dist/jsx-preview`): the inline JSX decorator puts
// `react/jsx-runtime` in the preview graph. In this build rspack was observed to
// list the inner modules of concatenated story modules under the container's
// name instead of their real names (cause not understood). See the "Stats shape"
// note in tests/turbosnap.test.ts.
export default {
  decorators: [withFrame, (Story: () => ReactNode) => <div>{Story()}</div>],
}

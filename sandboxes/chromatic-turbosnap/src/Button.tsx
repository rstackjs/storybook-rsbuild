// Adapted from chromatic-cli e2e fixtures (MIT), commit f744971ec44e03fd4fef4d2e2fcadf2fefb04627:
//   e2e/fixtures/react-rsbuild and e2e/fixtures/monorepo-pnpm
import { capitalize } from '@sandboxes/chromatic-turbosnap-shared'
import { Badge } from './Badge'

// In production builds Button and the shared helper are concatenated into the
// Button.stories module; Badge is imported by several modules, so it stays
// standalone. `capitalize` lives outside the Storybook project root.
export function Button({ label }: { label: string }) {
  return (
    <button type="button">
      {capitalize(label)} <Badge text="New" />
    </button>
  )
}

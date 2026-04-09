import { createLynxStorybook } from 'storybook-react-lynx-web-rsbuild/runtime'

import { Button } from '../src/components/Button.tsx'
import { Card } from '../src/components/Card.tsx'

createLynxStorybook({
  components: {
    Button: () => <Button />,
    Card: () => <Card />,
  },
})

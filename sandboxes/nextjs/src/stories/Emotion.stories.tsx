import styled from '@emotion/styled'
import type { Meta, StoryObj } from 'storybook-next-rsbuild'

const Box = styled.div`
  color: rgb(255, 199, 0);
`

// Regression target: @emotion/styled must resolve and inject styles through
// Rsbuild's bundle (runtime CSS-in-JS, no special transform).
function EmotionProbe() {
  return <Box data-testid="emotion-probe">emotion</Box>
}

const meta = { component: EmotionProbe } satisfies Meta<typeof EmotionProbe>

export default meta

export const Default: StoryObj<typeof meta> = {}

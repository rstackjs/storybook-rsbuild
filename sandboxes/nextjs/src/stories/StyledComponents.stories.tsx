import type { Meta, StoryObj } from 'storybook-next-rsbuild'
import styled from 'styled-components'

const Box = styled.div`
  color: rgb(255, 71, 133);
  font-weight: bold;
`

// Regression target: the next-swc `compiler.styledComponents` transform flows
// through our extracted loader chain and styles apply.
function StyledComponentsProbe() {
  return <Box data-testid="sc-probe">styled-components</Box>
}

const meta = {
  component: StyledComponentsProbe,
} satisfies Meta<typeof StyledComponentsProbe>

export default meta

export const Default: StoryObj<typeof meta> = {}

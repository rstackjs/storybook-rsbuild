import type { Meta, StoryObj } from '@storybook/react'
import { fn } from 'storybook/test'
import { CounterButton } from '../src/components/counter-button'

const meta = {
  title: 'Example/CounterButton',
  component: CounterButton,
  parameters: {
    layout: 'centered',
  },
  tags: ['autodocs'],
  args: { onClick: fn() },
} satisfies Meta<typeof CounterButton>

export default meta
type Story = StoryObj<typeof meta>

export const Primary: Story = {
  args: {
    label: 'CounterButton',
  },
}

import { Inter, Roboto_Mono } from 'next/font/google'
import type { Meta, StoryObj } from 'storybook-next-rsbuild'

const inter = Inter({ subsets: ['latin'] })
const robotoMono = Roboto_Mono({ subsets: ['latin'], variable: '--font-mono' })

function FontDemo({ className, style, label }: any) {
  return (
    <div className={className} style={style}>
      <h2>{label}</h2>
      <p>The quick brown fox jumps over the lazy dog.</p>
    </div>
  )
}

const meta = {
  component: FontDemo,
} satisfies Meta<typeof FontDemo>

export default meta

type Story = StoryObj<typeof meta>

export const InterFont: Story = {
  args: {
    className: inter.className,
    style: inter.style,
    label: 'Inter (Google Font)',
  },
}

export const RobotoMono: Story = {
  args: {
    className: robotoMono.className,
    style: robotoMono.style,
    label: 'Roboto Mono (Google Font)',
  },
}

export const CSSVariable: Story = {
  args: {
    className: robotoMono.variable,
    style: { fontFamily: 'var(--font-mono)' },
    label: 'Roboto Mono via CSS variable',
  },
}

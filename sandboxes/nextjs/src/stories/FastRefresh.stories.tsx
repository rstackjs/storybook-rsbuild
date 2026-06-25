import type { Meta, StoryObj } from 'storybook-next-rsbuild'
import { FastRefresh } from './FastRefresh'

const meta = { component: FastRefresh } satisfies Meta<typeof FastRefresh>

export default meta

export const Default: StoryObj<typeof meta> = {}

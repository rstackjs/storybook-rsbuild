import type { Meta, StoryObj } from '@storybook/html'

import { runAssetProbe } from './asset-probe'

const meta = {
  title: 'Example/Asset Probe',
  render: () => {
    const element = document.createElement('div')
    runAssetProbe(element)
    return element
  },
} satisfies Meta

export default meta

export const Default: StoryObj = {}

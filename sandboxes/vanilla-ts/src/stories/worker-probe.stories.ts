import type { Meta, StoryObj } from '@storybook/html'

import { runWorkerProbe } from './worker-probe'

const meta = {
  title: 'Example/Worker Probe',
  render: () => {
    const element = document.createElement('div')
    element.id = 'worker-probe'
    runWorkerProbe(element)
    return element
  },
} satisfies Meta

export default meta

export const Default: StoryObj = {}

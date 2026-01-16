import type { Meta, StoryObj } from '@storybook/react'
import exampleMarkdown from './assets/example.md?raw'

/**
 * A simple component that displays raw markdown content.
 * This story tests the `?raw` import functionality.
 */
const RawMarkdownDisplay = ({ content }: { content: string }) => {
  return (
    <pre
      style={{
        padding: '16px',
        backgroundColor: '#f5f5f5',
        borderRadius: '4px',
        overflow: 'auto',
        whiteSpace: 'pre-wrap',
      }}
    >
      {content}
    </pre>
  )
}

const meta: Meta<typeof RawMarkdownDisplay> = {
  title: 'Example/RawImport',
  component: RawMarkdownDisplay,
  parameters: {
    layout: 'padded',
  },
}

export default meta
type Story = StoryObj<typeof RawMarkdownDisplay>

/**
 * Demonstrates importing a markdown file as raw string using `?raw` query.
 */
export const MarkdownRaw: Story = {
  args: {
    content: exampleMarkdown,
  },
}

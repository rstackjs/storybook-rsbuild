import notes from './notes.md?raw'

const Raw = ({ content }: { content: string }) => <pre>{content}</pre>

export default { component: Raw }

export const Default = { args: { content: notes } }

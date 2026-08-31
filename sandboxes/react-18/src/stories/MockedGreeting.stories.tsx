import { getGreeting } from './utils/greeting'

const Template = () => (
  <div
    style={{
      padding: 12,
      border: '1px dashed #999',
      borderRadius: 6,
      fontFamily: 'system-ui, sans-serif',
    }}
  >
    <strong data-testid="greeting-text">{getGreeting('Storybook')}</strong>
  </div>
)

export default {
  title: 'Mock/MockedGreeting',
}

export const UsesMockedModule = {
  render: Template,
}

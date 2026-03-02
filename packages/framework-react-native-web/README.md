# storybook-react-native-web-rsbuild

Storybook for React Native Web and Rsbuild: Develop React Native components for web in isolation with Hot Reloading.

## Installation

```bash
npm install storybook-react-native-web-rsbuild react-native-web
```

## Usage

In your `.storybook/main.ts`:

```ts
import type { StorybookConfig } from 'storybook-react-native-web-rsbuild'

const config: StorybookConfig = {
  stories: ['../src/**/*.stories.@(js|jsx|ts|tsx)'],
  addons: ['@storybook/addon-docs'],
  framework: {
    name: 'storybook-react-native-web-rsbuild',
    options: {},
  },
}

export default config
```

## Framework Options

### modulesToTranspile

Many React Native packages ship untranspiled code. Use this option to add additional packages that need transpilation:

```ts
framework: {
  name: 'storybook-react-native-web-rsbuild',
  options: {
    modulesToTranspile: ['react-native-reanimated', 'nativewind'],
  },
}
```

By default, packages starting with `react-native`, `@react-native`, `expo`, and `@expo` are already included.

## Features

- Full React Native Web support with Rsbuild
- Aliases `react-native` to `react-native-web` automatically
- Handles untranspiled React Native packages
- Supports Flow syntax in React Native packages
- Compatible with Expo projects

## 🤖 Agent Skills

Using an AI coding agent? Install the agent skills for guided setup: `npx skills add rstackjs/agent-skills --skill storybook-rsbuild`

## License

MIT

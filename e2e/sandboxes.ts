export interface SandboxDefinition {
  name: string
  relativeDir: string
  port: number
  env?: Record<string, string>
}

export const sandboxes: SandboxDefinition[] = [
  { name: 'lit', relativeDir: 'sandboxes/lit', port: 6100 },
  {
    name: 'modernjs-react',
    relativeDir: 'sandboxes/modernjs-react',
    port: 6101,
    env: { SB_RSBUILD_TEST_MINIMAL_DEV: 'true' },
  },
  {
    name: 'modernjs-react-mf-host',
    relativeDir: 'sandboxes/modernjs-react-mf/host',
    port: 6102,
    env: { STORYBOOK: 'true' },
  },
  { name: 'react-16', relativeDir: 'sandboxes/react-16', port: 6103 },
  { name: 'react-18', relativeDir: 'sandboxes/react-18', port: 6104 },
  {
    name: 'react-native-web',
    relativeDir: 'sandboxes/react-native-web',
    port: 6105,
  },
  { name: 'react-testing', relativeDir: 'sandboxes/react-testing', port: 6106 },
  {
    name: 'rslib-react-component',
    relativeDir: 'sandboxes/rslib-react-component',
    port: 6107,
  },
  {
    name: 'rslib-react-mf',
    relativeDir: 'sandboxes/rslib-react-mf',
    port: 6108,
  },
  {
    name: 'rslib-vue3-component',
    relativeDir: 'sandboxes/rslib-vue3-component',
    port: 6109,
  },
  {
    name: 'rspack-react-18',
    relativeDir: 'sandboxes/rspack-react-18',
    port: 6110,
  },
  { name: 'vanilla-ts', relativeDir: 'sandboxes/vanilla-ts', port: 6111 },
  { name: 'vue3', relativeDir: 'sandboxes/vue3', port: 6112 },
]

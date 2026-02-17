import { appTools, defineConfig } from '@modern-js/app-tools'
import { moduleFederationPlugin } from '@module-federation/modern-js-v3'

// https://modernjs.dev/en/configure/app/usage
export default defineConfig({
  runtime: {
    router: true,
  },
  plugins: [
    appTools(),
    // In storybook, we don't need to use moduleFederationPlugin, because it will be used in `@module-federation/storybook-addon`
    ...(process.env.STORYBOOK ? [] : [moduleFederationPlugin()]),
  ],
})

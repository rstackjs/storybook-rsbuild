import path from 'node:path'
import { appTools, defineConfig } from '@modern-js/app-tools'
import { bffPlugin } from '@modern-js/plugin-bff'

// https://modernjs.dev/en/configure/app/usage
export default defineConfig({
  source: {
    alias: {
      '@my-src': path.resolve(__dirname, 'src'),
    },
  },
  plugins: [
    appTools(),
    bffPlugin(),
    {
      name: 'modern-js-rsbuild-plugin',
      setup(api) {
        api.modifyRsbuildConfig((_config) => {
          console.log('run builder hook')
        })
      },
    },
    {
      name: 'modern-js-plugin',
      setup(api) {
        api.config(() => {
          return {
            output: {
              disableTsChecker: true, // 关闭 TypeScript 类型检查
            },
          }
        })
      },
    },
    // Leak-bait plugin: only active when SB_RSBUILD_TEST_LEAK_PROBE is set.
    // Used by the e2e probe to verify storybook-addon-modernjs strips host
    // output fields (assetPrefix / filename) before merging into Storybook's
    // iframe config. See e2e/tests/modernjs-react.spec.ts.
    {
      name: 'modern-js-leak-probe',
      setup(api) {
        if (!process.env.SB_RSBUILD_TEST_LEAK_PROBE) {
          return
        }
        api.config(() => ({
          output: {
            assetPrefix: '/leak-probe-prefix/',
            filename: {
              js: 'leak-probe-[name].js',
            },
          },
        }))
      },
    },
  ],
  bff: {
    prefix: '/bff-api',
  },

  server:
    process.env.npm_lifecycle_event === 'e2e'
      ? undefined
      : {
          port: 8088,
        },
  dev: process.env.BFF_PROXY
    ? {
        server: {
          proxy: {
            '/bff-api': 'http://localhost:8088',
          },
        },
      }
    : {},
})

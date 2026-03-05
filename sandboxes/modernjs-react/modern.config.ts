import path from 'node:path'
import { appTools, defineConfig } from '@modern-js/app-tools'
import { bffPlugin } from '@modern-js/plugin-bff'

const runtimeConfig = {
  runtime: {
    router: true,
  },
}

// https://modernjs.dev/en/configure/app/usage
export default defineConfig({
  ...runtimeConfig,
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
  ],
  bff: {
    prefix: '/bff-api',
  },
  server: {
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

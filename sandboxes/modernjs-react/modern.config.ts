import path from 'node:path'
import { appTools, defineConfig } from '@modern-js/app-tools'

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
})

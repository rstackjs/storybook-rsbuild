import path from 'node:path'
import { appTools } from '@modern-js/app-tools'

type RsbuildPluginApi = {
  modifyRsbuildConfig: (modifier: (config: object) => void) => void
}

type ConfigPluginApi = {
  config: (modifier: () => { output: { disableTsChecker: boolean } }) => void
}

// https://modernjs.dev/en/configure/app/usage
export default {
  runtime: {
    router: true,
  },
  source: {
    alias: {
      '@my-src': path.resolve(__dirname, 'src'),
    },
  },
  plugins: [
    appTools(),
    {
      name: 'modern-js-rsbuild-plugin',
      setup(api: RsbuildPluginApi) {
        api.modifyRsbuildConfig((_config) => {
          console.log('run builder hook')
        })
      },
    },
    {
      name: 'modern-js-plugin',
      setup(api: ConfigPluginApi) {
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
}

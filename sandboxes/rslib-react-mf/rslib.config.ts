import { pluginModuleFederation } from '@module-federation/rsbuild-plugin'
import { pluginReact } from '@rsbuild/plugin-react'
import { pluginSass } from '@rsbuild/plugin-sass'
import { defineConfig, type LibConfig } from '@rslib/core'

const mfRemotePort = process.env.MF_REMOTE_PORT ?? '3001'
const mfRemoteBaseUrl = `http://localhost:${mfRemotePort}/mf`

const shared: LibConfig = {
  bundle: false,
  dts: {
    bundle: false,
  },
}

export default defineConfig({
  lib: [
    {
      ...shared,
      source: {
        entry: {
          index: ['./src/**', '!./src/env.d.ts'],
        },
      },
      format: 'esm',
      output: {
        distPath: {
          root: './dist/esm',
        },
      },
    },
    {
      ...shared,
      format: 'cjs',
      source: {
        entry: {
          index: ['./src/**', '!./src/env.d.ts'],
        },
      },
      output: {
        distPath: {
          root: './dist/cjs',
        },
      },
    },
    {
      format: 'mf',
      output: {
        distPath: {
          root: './dist/mf',
        },
        assetPrefix: mfRemoteBaseUrl,
      },
      dev: {
        assetPrefix: mfRemoteBaseUrl,
      },
      plugins: [
        pluginModuleFederation({
          name: 'rslib_provider',
          exposes: {
            '.': './src/index.tsx',
          },
          shared: {
            react: {
              singleton: true,
            },
            'react-dom': {
              singleton: true,
            },
          },
        }),
      ],
    },
  ],
  // just for dev
  server: {
    port: Number(mfRemotePort),
  },
  plugins: [
    pluginReact({
      swcReactOptions: {
        runtime: 'classic',
      },
    }),
    pluginSass(),
  ],
})

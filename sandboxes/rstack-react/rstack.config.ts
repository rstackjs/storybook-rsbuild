import { define } from 'rstack'

define.lib(async () => {
  const { pluginReact } = await import('@rsbuild/plugin-react')
  const { pluginSass } = await import('@rsbuild/plugin-sass')

  return {
    bundle: false,
    dts: { bundle: false },
    source: {
      entry: { index: ['./src/**', '!./src/env.d.ts'] },
    },
    lib: [
      { format: 'esm', output: { distPath: { root: './dist/esm' } } },
      { format: 'cjs', output: { distPath: { root: './dist/cjs' } } },
    ],
    plugins: [
      pluginReact({ swcReactOptions: { runtime: 'classic' } }),
      pluginSass(),
    ],
  }
})

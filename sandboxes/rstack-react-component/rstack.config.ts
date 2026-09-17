import { define } from 'rstack'

define.lib(async () => {
  const { pluginReact } = await import('@rsbuild/plugin-react')
  const { pluginSass } = await import('@rsbuild/plugin-sass')

  return {
    lib: [
      {
        bundle: false,
        format: 'esm',
        output: { distPath: { root: './dist' } },
      },
    ],
    plugins: [
      pluginReact({ swcReactOptions: { runtime: 'classic' } }),
      pluginSass(),
    ],
  }
})

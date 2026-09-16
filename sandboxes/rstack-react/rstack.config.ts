import { define } from 'rstack'

define.app(async () => {
  const { pluginReact } = await import('@rsbuild/plugin-react')
  const { pluginSass } = await import('@rsbuild/plugin-sass')

  return {
    plugins: [
      pluginReact({ swcReactOptions: { runtime: 'classic' } }),
      pluginSass(),
    ],
  }
})

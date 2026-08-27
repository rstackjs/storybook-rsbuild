import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

export const previewMainTemplate = () => {
  return require.resolve('storybook-builder-rsbuild/templates/preview.ejs')
}

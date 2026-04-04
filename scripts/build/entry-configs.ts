// @ts-expect-error
import addonModernjsConfig from '../../packages/addon-modernjs/build-config'
// @ts-expect-error
import addonRslibConfig from '../../packages/addon-rslib/build-config'
// @ts-expect-error
import builderConfig from '../../packages/builder-rsbuild/build-config'
// @ts-expect-error
import htmlFrameworkConfig from '../../packages/framework-html/build-config'
// @ts-expect-error
import reactFrameworkConfig from '../../packages/framework-react/build-config'
// @ts-expect-error
import reactLynxWebFrameworkConfig from '../../packages/framework-react-lynx-web/build-config'
// @ts-expect-error
import reactNativeWebFrameworkConfig from '../../packages/framework-react-native-web/build-config'
// @ts-expect-error
import vue3FrameworkConfig from '../../packages/framework-vue3/build-config'
// @ts-expect-error
import webComponentsFrameworkConfig from '../../packages/framework-web-components/build-config'
// @ts-expect-error
import rsbuildPluginRnwConfig from '../../packages/rsbuild-plugin-react-native-web/build-config'
import type { BuildEntriesByPackageName } from './utils/entry-utils'

export const buildEntries = {
  // builders
  'storybook-builder-rsbuild': builderConfig,

  // frameworks
  'storybook-html-rsbuild': htmlFrameworkConfig,
  'storybook-react-rsbuild': reactFrameworkConfig,
  'storybook-react-native-web-rsbuild': reactNativeWebFrameworkConfig,
  'storybook-vue3-rsbuild': vue3FrameworkConfig,
  'storybook-react-lynx-web-rsbuild': reactLynxWebFrameworkConfig,
  'storybook-web-components-rsbuild': webComponentsFrameworkConfig,

  // plugins
  'rsbuild-plugin-react-native-web': rsbuildPluginRnwConfig,

  // addons
  'storybook-addon-modernjs': addonModernjsConfig,
  'storybook-addon-rslib': addonRslibConfig,
}

export function isBuildEntries(key: string): key is keyof typeof buildEntries {
  return key in buildEntries
}

export function hasPrebuild(
  entry: BuildEntriesByPackageName[keyof BuildEntriesByPackageName],
): entry is BuildEntriesByPackageName[keyof BuildEntriesByPackageName] & {
  prebuild: (cwd: string) => Promise<void>
} {
  return 'prebuild' in entry
}

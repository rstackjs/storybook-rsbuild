import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { mergeRsbuildConfig } from '@rsbuild/core'
import { pluginSass } from '@rsbuild/plugin-sass'
import type { StorybookConfig } from 'storybook-next-rsbuild'

const getAbsolutePath = (value: string): any => {
  return path.resolve(
    fileURLToPath(
      new URL(import.meta.resolve(`${value}/package.json`, import.meta.url)),
    ),
    '..',
  )
}

const config: StorybookConfig = {
  stories: ['../src/**/*.mdx', '../src/**/*.stories.@(js|jsx|mjs|ts|tsx)'],
  addons: ['@storybook/addon-docs'],
  framework: {
    name: getAbsolutePath('storybook-next-rsbuild'),
    // Opt in so `next.config.webpack()` plugins (DefinePlugin etc.) reach the
    // Storybook bundle. The default is `false` because some webpack-only
    // plugins (CopyPlugin, source-map uploaders) crash rspack's IPC channel;
    // a story-level assertion below proves the opt-in path forwards safely.
    options: { forwardNextConfigPlugins: true },
  },
  staticDirs: ['../public'],
  // Enable Sass for the Scss story's `.module.scss`. @rsbuild/plugin-sass 1.x is
  // compatible with the pinned @rsbuild/core 1.x and merges into the config the
  // framework's own rsbuildFinal bridge produces.
  rsbuildFinal: (config) =>
    mergeRsbuildConfig(config, { plugins: [pluginSass()] }),
  // Steal .svg from Rsbuild's default asset rule so the SVGR rule the user
  // added via `next.config.webpack()` is the one that ultimately processes
  // them. Mirrors the safe-wallet pattern: SVGR cooperation typically needs
  // BOTH a next-side rule addition (via next.config.webpack) AND a
  // Storybook-side rule mutation (via .storybook webpackFinal) because the
  // two webpack-config layers don't see each other.
  // This also locks in `preset.ts`'s LATE webpackFinal invocation: if the
  // user hook ran against an empty-probe config it wouldn't see the rules
  // it needs to mutate, and the mutation would silently no-op.
  webpackFinal: async (config) => {
    // Steal .svg from Rsbuild's default asset `oneOf` chain (4 variants:
    // resource by ?url, inline by ?inline, source by ?raw, default = asset
    // size-based). They share an outer rule with `test: /\.svg$/` and no `use`
    // — setting `exclude` on the outer rule short-circuits every oneOf branch
    // in one go without enumerating them. SVGR (which we add via
    // next.config.webpack) has `use: ['@svgr/webpack']` and is left alone.
    for (const rule of config.module?.rules ?? []) {
      if (
        rule &&
        typeof rule === 'object' &&
        rule.test instanceof RegExp &&
        rule.test.test('probe.svg') &&
        Array.isArray(rule.oneOf)
      ) {
        const prev = (rule as any).exclude
        ;(rule as any).exclude = Array.isArray(prev)
          ? [...prev, /\.svg$/]
          : prev
            ? [prev, /\.svg$/]
            : /\.svg$/
      }
    }
    return config
  },
}

export default config

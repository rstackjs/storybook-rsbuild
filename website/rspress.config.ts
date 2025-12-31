import { defineConfig } from '@rspress/core'
import { pluginAlgolia } from '@rspress/plugin-algolia'
import { pluginLlms } from '@rspress/plugin-llms'
import { pluginSitemap } from '@rspress/plugin-sitemap'
import { pluginTwoslash } from '@rspress/plugin-twoslash'
import {
  transformerNotationDiff,
  transformerNotationFocus,
  transformerNotationHighlight,
} from '@shikijs/transformers'
import { pluginOpenGraph } from 'rsbuild-plugin-open-graph'
import { pluginFontOpenSans } from 'rspress-plugin-font-open-sans'

const siteUrl = 'https://storybook.rsbuild.rs'
const siteDescription = 'Storybook builder and frameworks powered by Rsbuild.'
const heroImage = `${siteUrl}/storybook-rsbuild.svg`

export default defineConfig({
  plugins: [
    pluginAlgolia({
      verificationContent: '8D19FD11BAF8DB11',
    }),
    pluginFontOpenSans(),
    pluginLlms(),
    pluginTwoslash(),
    pluginSitemap({
      siteUrl,
    }),
  ],
  root: 'docs',
  title: 'Storybook Rsbuild',
  description: siteDescription,
  icon: '/storybook-rsbuild.svg',
  logo: {
    light: '/storybook-rsbuild-dark-text.svg',
    dark: '/storybook-rsbuild-light-text.svg',
  },
  markdown: {
    shiki: {
      langs: ['ts', 'tsx', 'json'],
      langAlias: {
        shell: 'bash',
      },
      transformers: [
        transformerNotationDiff(),
        transformerNotationHighlight(),
        transformerNotationFocus(),
      ],
    },
  },
  route: {
    cleanUrls: true,
  },
  themeConfig: {
    socialLinks: [
      {
        icon: 'github',
        mode: 'link',
        content: 'https://github.com/rstackjs/storybook-rsbuild',
      },
    ],
  },
  builderConfig: {
    plugins: [
      pluginOpenGraph({
        title: 'Storybook Rsbuild',
        url: siteUrl,
        description: siteDescription,
        image: heroImage,
        twitter: {
          card: 'summary_large_image',
        },
      }),
    ],
  },
})

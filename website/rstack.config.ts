import { pluginAlgolia } from '@rspress/plugin-algolia'
import { pluginSitemap } from '@rspress/plugin-sitemap'
import { pluginTwoslash } from '@rspress/plugin-twoslash'
import {
  transformerNotationDiff,
  transformerNotationFocus,
  transformerNotationHighlight,
} from '@shikijs/transformers'
import { readFileSync } from 'node:fs'
import { pluginOpenGraph } from 'rsbuild-plugin-open-graph'
import { pluginFontOpenSans } from 'rspress-plugin-font-open-sans'
import { define } from 'rstack'

const siteUrl = 'https://storybook.rsbuild.rs'
const siteDescription = 'Storybook builder and frameworks powered by Rsbuild.'
const siteDescriptionZh = '由 Rsbuild 驱动的 Storybook builder 与 frameworks。'
const heroImage = `${siteUrl}/storybook-rsbuild.svg`

const peerRange = (pkg: string, name: string): string => {
  const manifest = JSON.parse(
    readFileSync(
      new URL(`../packages/${pkg}/package.json`, import.meta.url),
      'utf8',
    ),
  ) as { peerDependencies?: Record<string, string> }
  const range = manifest.peerDependencies?.[name]
  if (!range)
    throw new Error(`"${name}" is not a peerDependency of packages/${pkg}`)
  return range
}

// Injected as `__PEER_RANGES__` for the `<PeerRange />` theme component (see
// `theme/peer-range.tsx` and `theme/env.d.ts`), so docs never drift from the
// published manifests. `framework-react` stands in for every framework
// package: `pnpm check-dependency-version` keeps their peer ranges identical.
const peerRanges: typeof __PEER_RANGES__ = {
  storybook: peerRange('framework-react', 'storybook'),
  '@rsbuild/core': peerRange('framework-react', '@rsbuild/core'),
  'react-native-web': peerRange(
    'framework-react-native-web',
    'react-native-web',
  ),
}
define.doc({
  plugins: [
    pluginAlgolia({
      verificationContent: '8D19FD11BAF8DB11',
    }),
    pluginFontOpenSans(),
    pluginTwoslash(),
    pluginSitemap({
      siteUrl,
    }),
  ],
  root: 'docs',
  lang: 'en',
  title: 'Storybook Rsbuild',
  description: siteDescription,
  icon: '/storybook-rsbuild.svg',
  logo: {
    light: '/storybook-rsbuild-dark-text.svg',
    dark: '/storybook-rsbuild-light-text.svg',
  },
  llms: true,
  search: {
    codeBlocks: true,
  },
  markdown: {
    link: {
      checkDeadLinks: true,
    },
    shiki: {
      langs: ['ts', 'tsx', 'json'],
      langAlias: {
        shell: 'bash',
      },
      // `@shikijs/transformers` resolves its own `@shikijs/types` (4.4.x) while
      // `@rspress/core` still resolves 4.3.x. The two `ShikiTransformer` types
      // differ only in `includeExplanation` and are runtime-compatible.
      // Drop the `@ts-expect-error`s once Rspress resolves shiki 4.4+.
      transformers: [
        // @ts-expect-error -- shiki types version mismatch, see above
        transformerNotationDiff(),
        // @ts-expect-error -- shiki types version mismatch, see above
        transformerNotationHighlight(),
        // @ts-expect-error -- shiki types version mismatch, see above
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
    editLink: {
      docRepoBaseUrl:
        'https://github.com/rstackjs/storybook-rsbuild/tree/main/website/docs',
    },
    locales: [
      {
        lang: 'en',
        label: 'English',
        description: siteDescription,
      },
      {
        lang: 'zh',
        label: '简体中文',
        description: siteDescriptionZh,
      },
    ],
  },
  builderConfig: {
    source: {
      define: {
        __PEER_RANGES__: JSON.stringify(peerRanges),
      },
    },
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

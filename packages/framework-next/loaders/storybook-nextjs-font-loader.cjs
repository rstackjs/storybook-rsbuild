/**
 * Faithful port of `@storybook/nextjs`'s `storybook-nextjs-font-loader`,
 * collapsed into one self-contained CJS loader (the upstream split across
 * `google/`, `local/`, and `utils/` is kept here as internal functions).
 *
 * Why this exists: `next-swc` unconditionally rewrites `next/font/*` calls into
 * `import … from "next/font/google/target.css?{json}"`. This loader matches that
 * synthetic `target.css` module (its on-disk content is empty and ignored) and
 * replaces it with a JS module that injects the resolved `@font-face` + class
 * CSS into `document.head` at runtime, and exports `{ className, style, variable }`.
 *
 * Adopting the upstream Storybook approach lets Rsbuild own all *real* CSS: we no
 * longer pull Next.js's CSS rule chain, so the brittle `oneOf`/`issuer` surgery
 * and the `/_next/static/media/` URL-rewrite shim are gone. Google fonts come
 * from the CDN (absolute URLs, no binary emission); local fonts reference the
 * project's files via relative `url(.…)`.
 *
 * Ships uncompiled and resolves `next`/`storybook` from the consumer's project.
 * @see https://github.com/storybookjs/storybook/blob/next/code/frameworks/nextjs/src/font/webpack/loader/storybook-nextjs-font-loader.ts
 */
const { sep } = require('node:path')

const cssCache = new Map()

async function getGoogleFontFaceDeclarations(options) {
  const {
    validateGoogleFontFunctionCall,
  } = require('next/dist/compiled/@next/font/dist/google/validate-google-font-function-call.js')
  const {
    getFontAxes,
  } = require('next/dist/compiled/@next/font/dist/google/get-font-axes.js')
  const {
    getGoogleFontsUrl,
  } = require('next/dist/compiled/@next/font/dist/google/get-google-fonts-url.js')
  const {
    fetchCSSFromGoogleFonts,
  } = require('next/dist/compiled/@next/font/dist/google/fetch-css-from-google-fonts.js')
  const loaderUtils = require('next/dist/compiled/loader-utils3/index.js')

  const {
    fontFamily,
    weights,
    styles,
    selectedVariableAxes,
    display,
    variable,
  } = validateGoogleFontFunctionCall(options.fontFamily, options.props)

  const fontAxes = getFontAxes(
    fontFamily,
    weights,
    styles,
    selectedVariableAxes,
  )
  const url = getGoogleFontsUrl(fontFamily, fontAxes, display)

  try {
    // Cache by URL but evict on the second hit: Next.js fetches each font twice
    // (normal + preload pass); a one-shot cache spares the duplicate request
    // without holding every font's CSS for the whole build.
    const hasCachedCSS = cssCache.has(url)
    const fontFaceCSS = hasCachedCSS
      ? cssCache.get(url)
      : await fetchCSSFromGoogleFonts(url, fontFamily, true).catch(() => null)
    if (!hasCachedCSS) {
      cssCache.set(url, fontFaceCSS)
    } else {
      cssCache.delete(url)
    }
    if (fontFaceCSS === null) {
      throw new Error(`Failed to fetch \`${fontFamily}\` from Google Fonts.`)
    }

    return {
      id: loaderUtils.getHashDigest(url, 'md5', 'hex', 6),
      fontFamily,
      fontFaceCSS,
      weights,
      styles,
      variable,
    }
  } catch (error) {
    throw new Error(
      `Failed to download \`${fontFamily}\` from Google Fonts (${url}): ${
        error?.message ?? error
      }`,
    )
  }
}

async function getLocalFontFaceDeclarations(options, rootContext, swcMode) {
  const { dirname, join } = require('node:path')
  const {
    validateLocalFontFunctionCall,
  } = require('next/dist/compiled/@next/font/dist/local/validate-local-font-function-call.js')
  const loaderUtils = require('next/dist/compiled/loader-utils3/index.js')
  const { getProjectRoot } = require('storybook/internal/common')

  const localFontSrc = options.props.src

  // Parent folder of the issuer file, relative to the root context — local font
  // `src` paths are resolved relative to the file that called `next/font/local`.
  const parentFolder = swcMode
    ? dirname(join(getProjectRoot(), options.filename)).replace(rootContext, '')
    : dirname(options.filename).replace(rootContext, '')

  const {
    weight,
    style,
    variable,
    declarations = [],
  } = validateLocalFontFunctionCall('', options.props)

  const id = `font-${loaderUtils.getHashDigest(
    Buffer.from(JSON.stringify(localFontSrc)),
    'md5',
    'hex',
    6,
  )}`

  const fontDeclarations = declarations
    .map(({ prop, value }) => `${prop}: ${value};`)
    .join('\n')

  const getFontFaceCSS = () => {
    if (typeof localFontSrc === 'string') {
      const localFontPath = join(parentFolder, localFontSrc).replaceAll(
        '\\',
        '/',
      )
      return `@font-face {
          font-family: ${id};
          src: url(.${localFontPath});
          ${weight ? `font-weight: ${weight};` : ''}
          ${style ? `font-style: ${style};` : ''}
          ${fontDeclarations}
      }`
    }
    return localFontSrc
      .map((font) => {
        const localFontPath = join(parentFolder, font.path).replaceAll(
          '\\',
          '/',
        )
        return `@font-face {
          font-family: ${id};
          src: url(.${localFontPath});
          ${font.weight ? `font-weight: ${font.weight};` : ''}
          ${font.style ? `font-style: ${font.style};` : ''}
          ${fontDeclarations}
        }`
      })
      .join('')
  }

  return {
    id,
    fontFamily: id,
    fontFaceCSS: getFontFaceCSS(),
    weights: weight ? [weight] : [],
    styles: style ? [style] : [],
    variable,
  }
}

function isNextCSSPropertyValid(prop) {
  return prop.length === 1 && prop[0] !== 'variable'
}

function getClassName({ styles, weights, fontFamily }) {
  const font = fontFamily.replaceAll(' ', '-').toLowerCase()
  const style = isNextCSSPropertyValid(styles) ? styles[0] : null
  const weight = isNextCSSPropertyValid(weights)
    ? weights[0]?.replaceAll(' ', '-')
    : null
  return `${font}${style ? `-${style}` : ''}${weight ? `-${weight}` : ''}`
}

function getStylesObj({ styles, weights, fontFamily }) {
  return {
    fontFamily,
    ...(isNextCSSPropertyValid(styles) ? { fontStyle: styles[0] } : {}),
    ...(isNextCSSPropertyValid(weights) ? { fontWeight: weights[0] } : {}),
  }
}

/**
 * `font-display: optional` blocks Storybook from showing the font because the
 * `@font-face` is injected after first paint; swap to `block` so it renders.
 */
function changeFontDisplayToSwap(css) {
  return css.replaceAll('font-display: optional;', 'font-display: block;')
}

function getCSSMeta(options) {
  const className = getClassName(options)
  const style = getStylesObj(options)
  const variableClassName = `__variable_${className}`

  const classNamesCSS = `
    .${className} {
      font-family: ${options.fontFamily};
      ${isNextCSSPropertyValid(options.styles) ? `font-style: ${options.styles[0]};` : ''}
      ${
        isNextCSSPropertyValid(options.weights) &&
        !options.weights[0]?.includes(' ')
          ? `font-weight: ${options.weights[0]};`
          : ''
      }
    }

    ${
      options.variable
        ? `.${variableClassName} { ${options.variable}: '${options.fontFamily}'; }`
        : ''
    }
  `

  return {
    className,
    fontFaceCSS: changeFontDisplayToSwap(options.fontFaceCSS),
    classNamesCSS,
    style,
    ...(options.variable ? { variableClassName } : {}),
  }
}

function setFontDeclarationsInHead({ id, fontFaceCSS, classNamesCSS }) {
  return `
    if (!document.getElementById('id-${id}')) {
      const fontDeclarations = \`${fontFaceCSS}\`;
      const style = document.createElement('style');
      style.setAttribute('id', 'font-face-${id}');
      style.innerHTML = fontDeclarations;
      document.head.appendChild(style);

      const classNamesCSS = \`${classNamesCSS}\`;
      const classNamesStyle = document.createElement('style');
      classNamesStyle.setAttribute('id', 'classnames-${id}');
      classNamesStyle.innerHTML = classNamesCSS;
      document.head.appendChild(classNamesStyle);
    }
  `
}

module.exports = async function storybookNextjsFontLoader() {
  const loaderOptions = this.getOptions()
  let swcMode = false
  let options

  if (Object.keys(loaderOptions).length > 0) {
    // Babel mode: the font transform passes options directly.
    options = loaderOptions
  } else {
    // SWC mode: the font config rides on the `target.css?{json}` query.
    const importQuery = JSON.parse(this.resourceQuery.slice(1))
    swcMode = true
    options = {
      filename: importQuery.path,
      fontFamily: importQuery.import,
      props: importQuery.arguments[0],
      source: this.context.replace(this.rootContext, ''),
    }
  }

  const rootCtx = this.rootContext
  let fontFaceDeclaration

  if (
    options.source.endsWith(`next${sep}font${sep}google`) ||
    options.source.endsWith(`@next${sep}font${sep}google`)
  ) {
    fontFaceDeclaration = await getGoogleFontFaceDeclarations(options)
  }

  if (
    options.source.endsWith(`next${sep}font${sep}local`) ||
    options.source.endsWith(`@next${sep}font${sep}local`)
  ) {
    fontFaceDeclaration = await getLocalFontFaceDeclarations(
      options,
      rootCtx,
      swcMode,
    )
  }

  if (typeof fontFaceDeclaration !== 'undefined') {
    const cssMeta = getCSSMeta(fontFaceDeclaration)
    return `
    ${setFontDeclarationsInHead({
      fontFaceCSS: cssMeta.fontFaceCSS,
      id: fontFaceDeclaration.id,
      classNamesCSS: cssMeta.classNamesCSS,
    })}

    module.exports = {
      className: "${cssMeta.className}",
      style: ${JSON.stringify(cssMeta.style)}
      ${cssMeta.variableClassName ? `, variable: "${cssMeta.variableClassName}"` : ''}
    }
    `
  }

  return `module.exports = {}`
}

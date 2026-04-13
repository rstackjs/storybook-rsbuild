/**
 * Rspack loader for next/font (google & local).
 *
 * SWC's fontLoaders transform rewrites font calls into CSS imports:
 *   Inter({ subsets: ['latin'] })  →  import inter from 'next/font/google/target.css?{...}'
 *
 * Next.js's own next-font-loader outputs CSS that feeds into css-loader +
 * CssExtractRspackPlugin. We can't reuse that full chain because it conflicts
 * with Rsbuild's own CSS pipeline. Instead, we call Next.js's internal font
 * loader *functions* directly (google/loader.js, local/loader.js), then wrap
 * the resulting CSS into a JS module that injects <style> tags at runtime and
 * exports { className, style, variable }.
 *
 * This file ships uncompiled — it resolves `next` from the user's project.
 */

const path = require('node:path')
const loaderUtils = require('next/dist/compiled/loader-utils3/index.js')

// ---------------------------------------------------------------------------
// Call Next.js's font loader functions directly
// ---------------------------------------------------------------------------

/**
 * Encode font binary as a data URL so the browser can load it inline.
 * Next.js's loader replaces every Google CDN / local-file URL with whatever
 * this callback returns — returning '' would produce broken `src: url()`.
 */
function emitFontAsDataUrl(content, ext) {
  const mime =
    ext === 'woff2'
      ? 'font/woff2'
      : ext === 'woff'
        ? 'font/woff'
        : `font/${ext}`
  return `data:${mime};base64,${Buffer.from(content).toString('base64')}`
}

async function loadGoogleFont(functionName, data) {
  const googleLoader =
    require('next/dist/compiled/@next/font/dist/google/loader.js').default

  return googleLoader({
    functionName,
    data,
    emitFontFile: emitFontAsDataUrl,
    isDev: true,
    isServer: false,
  })
}

async function loadLocalFont(functionName, data, resolve) {
  const localLoader =
    require('next/dist/compiled/@next/font/dist/local/loader.js').default

  return localLoader({
    functionName,
    data,
    emitFontFile: emitFontAsDataUrl,
    isDev: true,
    isServer: false,
    resolve,
    loaderContext: null,
  })
}

// ---------------------------------------------------------------------------
// CSS → JS module conversion (the part Next.js's CSS pipeline normally does)
// ---------------------------------------------------------------------------

function buildJSModule(css, weight, style, variable) {
  const fontFamilyHash = loaderUtils.getHashDigest(
    Buffer.from(css),
    'md5',
    'hex',
    6,
  )

  // Parse font-family name from the first @font-face in the CSS
  const fontFamilyMatch = css.match(/font-family:\s*['"]?([^;'"]+)/)
  const fontFamily = fontFamilyMatch
    ? fontFamilyMatch[1].trim()
    : fontFamilyHash
  const slug = fontFamily.replaceAll(' ', '-').toLowerCase()

  const className = `${slug}${style && style !== 'normal' ? `-${style}` : ''}${weight ? `-${weight}` : ''}`
  const variableClassName = variable ? `__variable_${className}` : undefined

  // Replace font-display: optional → block so fonts render immediately
  const fontFaceCSS = css.replaceAll(
    'font-display: optional;',
    'font-display: block;',
  )

  const classNamesCSS = `
    .${className} { font-family: ${fontFamily}; ${style ? `font-style: ${style};` : ''} ${weight && !String(weight).includes(' ') ? `font-weight: ${weight};` : ''} }
    ${variableClassName ? `.${variableClassName} { ${variable}: '${fontFamily}'; }` : ''}
  `

  const styleObj = {
    fontFamily,
    ...(style ? { fontStyle: style } : {}),
    ...(weight ? { fontWeight: weight } : {}),
  }

  return `
    if (typeof document !== 'undefined' && !document.getElementById('font-${fontFamilyHash}')) {
      var s = document.createElement('style');
      s.id = 'font-${fontFamilyHash}';
      s.innerHTML = ${JSON.stringify(fontFaceCSS + classNamesCSS)};
      document.head.appendChild(s);
    }
    module.exports = {
      className: ${JSON.stringify(className)},
      style: ${JSON.stringify(styleObj)}${variableClassName ? `,\n      variable: ${JSON.stringify(variableClassName)}` : ''}
    };
  `
}

// ---------------------------------------------------------------------------
// Main loader entry
// ---------------------------------------------------------------------------
module.exports = async function storybookNextFontLoader() {
  const {
    path: filePath,
    import: functionName,
    arguments: data,
  } = JSON.parse(this.resourceQuery.slice(1))

  const source = this.context.replace(this.rootContext, '')

  try {
    let result
    if (/next[\\/]font[\\/]google$/.test(source)) {
      result = await loadGoogleFont(functionName, data)
    } else if (/next[\\/]font[\\/]local$/.test(source)) {
      const { promisify } = require('node:util')
      const resolve = (src) =>
        promisify(this.resolve)(
          path.dirname(path.join(this.rootContext, filePath)),
          src.startsWith('.') ? src : `./${src}`,
        )
      result = await loadLocalFont(functionName, data, resolve)
    }

    if (result?.css) {
      return buildJSModule(
        result.css,
        result.weight,
        result.style,
        result.variable,
      )
    }
  } catch (err) {
    console.warn(`[storybook-next-rsbuild] Font loading failed: ${err.message}`)
  }

  return 'module.exports = {}'
}

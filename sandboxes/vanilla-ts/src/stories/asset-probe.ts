import './asset-probe.css'
// Both this SVG and the PNG behind the CSS `url()` must stay above
// `output.dataUriLimit` (4096 bytes for svg/image). Shrink either below it and
// Rspack inlines it as a data URI, turning both assertions below into no-ops.
import gridSvg from './assets/asset-probe-grid.svg'

async function urlLoads(url: string): Promise<boolean> {
  try {
    const response = await fetch(url)
    return response.ok
  } catch {
    return false
  }
}

function backgroundUrl(element: HTMLElement): string | null {
  const match = /url\(["']?(.+?)["']?\)/.exec(
    getComputedStyle(element).backgroundImage,
  )
  return match ? match[1] : null
}

// An `<img src>` resolves against the document, so it loads at any depth —
// reporting where the file landed is what makes this assertion able to fail.
function outputLocation(url: string): 'root' | 'nested' {
  const base = new URL('.', document.baseURI).pathname
  const path = new URL(url, document.baseURI).pathname
  return path.slice(base.length).includes('/') ? 'nested' : 'root'
}

export function runAssetProbe(root: HTMLElement) {
  const background = document.createElement('div')
  background.id = 'asset-probe-background'

  const image = document.createElement('img')
  image.src = gridSvg
  image.alt = 'asset probe grid'

  const status = document.createElement('div')
  status.id = 'asset-probe-status'
  status.textContent = 'pending'

  root.append(background, image, status)

  // The story element is still detached during render(), so getComputedStyle
  // sees no stylesheet yet — wait a frame before reading the background.
  requestAnimationFrame(async () => {
    const cssUrl = backgroundUrl(background)
    const cssOk = cssUrl ? await urlLoads(cssUrl) : false
    const svgOk = await urlLoads(image.src)
    const svgAt = svgOk ? outputLocation(image.src) : 'fail'
    status.textContent = `css: ${cssOk ? 'ok' : 'fail'} svg: ${svgAt}`
  })
}

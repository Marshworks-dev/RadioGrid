/**
 * Draw every app icon from icon.svg, so the mark is drawn once:
 *
 *   node make-icons.mjs
 *
 * Writes the PWA icons (icon-192.png, icon-512.png) and the iOS app icon
 * (1024px, no alpha channel: the App Store refuses one). Rerun after any change to icon.svg;
 * tests/logo.test.mjs fails while an icon is stale.
 *
 * Playwright draws the PNGs because it is already a dev dependency (guide
 * screenshots, promise checks), so this adds no new one. It needs
 * `npx playwright install chromium` and the sandbox off.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const repo = dirname(fileURLToPath(import.meta.url))

/** Every PNG drawn from icon.svg: where it goes and its size in pixels. */
export const PNG_ICONS = [
  { file: 'icon-192.png', size: 192 },
  { file: 'icon-512.png', size: 512 },
  { file: 'ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png', size: 1024 },
]

/** The mark's tiles as icon.svg draws them, before its own scaling. */
export function iconTiles(svg) {
  return [...svg.matchAll(/<rect fill="(#[0-9a-f]{6})" x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)" rx="([\d.]+)"\/>/g)]
    .map(([, fill, x, y, w, h, rx]) => ({ fill, x: Number(x), y: Number(y), w: Number(w), h: Number(h), rx: Number(rx) }))
}

async function main() {
  const svg = readFileSync(join(repo, 'icon.svg'), 'utf-8')
  const write = (file, data) => {
    mkdirSync(dirname(join(repo, file)), { recursive: true })
    writeFileSync(join(repo, file), data)
    console.log('wrote', file)
  }
  const { chromium } = await import('playwright')
  const browser = await chromium.launch()
  try {
    for (const { file, size } of PNG_ICONS) {
      const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 })
      // Inline, since a blank page may not load a file: image.
      await page.setContent(`<style>html,body{margin:0}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`)
      // A page screenshot has no alpha channel (omitBackground is off), which the iOS icon needs.
      write(file, await page.screenshot({ type: 'png' }))
      await page.close()
    }
  } finally {
    await browser.close()
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main()

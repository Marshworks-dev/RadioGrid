/**
 * Draw the settings "Have feedback?" QR code into src/shell.html, then
 * rebuild RadioGridXL.html from src/ (build.mjs).
 *
 * The code always opens FEEDBACK_URL, a static page beside the app, so it is
 * drawn once and stored in the app as an inline SVG between sentinel
 * comments: the shipped file gains no QR code of its own and stays
 * self-contained. Rerun only if FEEDBACK_URL changes:
 *
 *   node make-feedback-qr.mjs
 *
 * qrcode-generator is dev-only (zero dependencies, MIT, stable with rare
 * releases): encoding a QR by hand
 * means Reed-Solomon and masking, not worth writing. tests/feedback.test.mjs
 * decodes the stored image with a different library (jsQR), so a wrong or
 * broken code fails npm test.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import qrcode from 'qrcode-generator'
import { build } from './build.mjs'

export const FEEDBACK_URL = 'https://radio.marshworks.dev/feedback/'
// What the code's label reads: the address without scheme or trailing slash.
export const FEEDBACK_LABEL = FEEDBACK_URL.replace(/^https:\/\//, '').replace(/\/$/, '')
export const QR_START = '<!-- === FEEDBACK QR — make-feedback-qr.mjs writes this === -->'
export const QR_END = '<!-- === END FEEDBACK QR === -->'
const QUIET = 4 // modules of light margin on each side, as the QR spec asks

/** The inline SVG for `url`: a white square with the dark modules as one
    path, one horizontal run per subpath. */
export function feedbackQrSvg(url = FEEDBACK_URL) {
  const qr = qrcode(0, 'M') // 0: smallest version that fits; M: ~15% damage tolerance
  qr.addData(url)
  qr.make()
  const n = qr.getModuleCount()
  const size = n + QUIET * 2
  let d = ''
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (!qr.isDark(r, c)) continue
      let run = 1
      while (c + run < n && qr.isDark(r, c + run)) run++
      d += `M${c + QUIET} ${r + QUIET}h${run}v1h-${run}z`
      c += run - 1
    }
  }
  return `<svg class="feedback-qr" id="feedback-qr" viewBox="0 0 ${size} ${size}" role="img" aria-label="QR code: opens ${FEEDBACK_LABEL} on your phone" shape-rendering="crispEdges"><rect width="${size}" height="${size}" fill="#ffffff"/><path fill="#000000" d="${d}"/></svg>`
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = dirname(fileURLToPath(import.meta.url))
  const file = join(root, 'src', 'shell.html')
  const html = readFileSync(file, 'utf8')
  const s = html.indexOf(QR_START)
  const e = html.indexOf(QR_END)
  if (s < 0 || e < s) {
    console.error('make-feedback-qr: sentinel comments not found in src/shell.html')
    process.exit(1)
  }
  writeFileSync(file, html.slice(0, s + QR_START.length) + feedbackQrSvg() + html.slice(e))
  writeFileSync(join(root, 'RadioGridXL.html'), build())
  console.log(`make-feedback-qr: drew ${FEEDBACK_URL} and rebuilt RadioGridXL.html`)
}

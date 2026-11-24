/**
 * Copy the MarshWorks "made by" block from the brand kit into the app, then
 * rebuild RadioGridXL.html from src/ (build.mjs).
 *
 * The kit is the one place the logo and credit are decided
 * (marshworks-brand, published at marshworks.dev/brand/). The radio never
 * loads it while someone is listening: the block is copied in here, stored
 * in brand/ as it came, and written into src/ between sentinel comments, so
 * the shipped file stays self-contained. Rerun after the brand changes:
 *
 *   node sync-brand.mjs ../marshworks-brand
 *
 * The radio takes the plain block, the one with no link: it never opens a
 * website (tests/promise-stays-radio.test.mjs). tests/credit.test.mjs fails if src/ and brand/
 * differ, or if the block holds anything that could be tapped.
 */
import { copyFileSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { build } from './build.mjs'

const root = dirname(fileURLToPath(import.meta.url))

export const BLOCK_FILE = 'marshworks-made-by.html'
export const STYLE_FILE = 'marshworks-made-by.css'
export const BLOCK_START = '<!-- === MADE BY — sync-brand.mjs writes this === -->'
export const BLOCK_END = '<!-- === END MADE BY === -->'
export const STYLE_START = '/* === MADE BY — sync-brand.mjs writes this === */'
export const STYLE_END = '/* === END MADE BY === */'
export const SHELL = join('src', 'shell.html')
export const STYLES = join('src', 'styles', '07-editor-browser.css')

/** `text` with `content` put between the two sentinels. */
export function between(text, start, end, content, file) {
  const s = text.indexOf(start)
  const e = text.indexOf(end)
  if (s < 0 || e < s) throw new Error(`sync-brand: sentinel comments not found in ${file}`)
  return text.slice(0, s + start.length) + content + text.slice(e)
}

/** What src/shell.html and the stylesheet should hold, given the kit copy in brand/. */
export function withBrand(dir = root) {
  const block = readFileSync(join(dir, 'brand', BLOCK_FILE), 'utf8').trim()
  const style = readFileSync(join(dir, 'brand', STYLE_FILE), 'utf8').trim()
  return {
    shell: between(readFileSync(join(dir, SHELL), 'utf8'), BLOCK_START, BLOCK_END, block, SHELL),
    styles: between(readFileSync(join(dir, STYLES), 'utf8'), STYLE_START, STYLE_END, `\n${style}\n`, STYLES),
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const kit = process.argv[2]
  if (!kit) {
    console.error('usage: node sync-brand.mjs <path to marshworks-brand>')
    process.exit(1)
  }
  // The kit says which files are the block; nothing else is taken from it.
  const { madeBy } = JSON.parse(readFileSync(join(kit, 'dist', 'brand.json'), 'utf8'))
  if (madeBy?.plain !== BLOCK_FILE || madeBy?.css !== STYLE_FILE) {
    console.error(`sync-brand: the kit no longer names ${BLOCK_FILE} and ${STYLE_FILE} as its made-by block`)
    process.exit(1)
  }
  for (const name of [BLOCK_FILE, STYLE_FILE]) copyFileSync(join(kit, 'dist', name), join(root, 'brand', name))
  const { shell, styles } = withBrand()
  writeFileSync(join(root, SHELL), shell)
  writeFileSync(join(root, STYLES), styles)
  writeFileSync(join(root, 'RadioGridXL.html'), build())
  console.log(`sync-brand: copied the made-by block from ${kit} and rebuilt RadioGridXL.html`)
}

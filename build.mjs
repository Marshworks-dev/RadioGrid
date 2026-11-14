#!/usr/bin/env node
/**
 * build.mjs — assembles RadioGridXL.html from src/.
 *
 * src/shell.html is the page with two marker lines: `<!-- @styles -->` and
 * `<!-- @script -->`. Each marker line is replaced by the files in
 * src/styles/*.css or src/app/*.js, joined in filename order (the number
 * prefix is the order). Plain concatenation, not modules: the script stays
 * one classic inline <script> with shared globals, which the inline
 * handlers, the tests and the file:// APK all rely on.
 *
 * The output is committed: everything downstream (tests, build-profile,
 * the hosted sync, server.js, Docker, the APK) reads RadioGridXL.html.
 * Edit src/, run `npm run build`, commit both.
 *
 * Usage:
 *   node build.mjs           write RadioGridXL.html
 *   node build.mjs --check   exit 1 if RadioGridXL.html differs from a fresh build
 */

import { readFileSync, writeFileSync, readdirSync, realpathSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(fileURLToPath(import.meta.url))
const src = join(root, 'src')
const outPath = join(root, 'RadioGridXL.html')

/** The files in a src/ folder with this extension, joined in name order. */
function joinFolder(folder, ext) {
  const dir = join(src, folder)
  const names = readdirSync(dir).filter((n) => n.endsWith(ext)).sort()
  if (names.length === 0) throw new Error(`build: no ${ext} files in src/${folder}`)
  return names.map((n) => readFileSync(join(dir, n), 'utf-8')).join('')
}

/** Swap one whole marker line for `content`; the marker must appear once. */
function fillMarker(html, marker, content) {
  const line = marker + '\n'
  const at = html.indexOf(line)
  if (at < 0 || html.indexOf(line, at + 1) >= 0) {
    throw new Error(`build: src/shell.html needs exactly one "${marker}" line`)
  }
  return html.slice(0, at) + content + html.slice(at + line.length)
}

export function build() {
  let html = readFileSync(join(src, 'shell.html'), 'utf-8')
  html = fillMarker(html, '<!-- @styles -->', joinFolder('styles', '.css'))
  html = fillMarker(html, '<!-- @script -->', joinFolder('app', '.js'))
  return html
}

// realpath: run through a symlinked path (macOS /var → /private/var) this
// guard would otherwise skip silently, and --check would pass without checking.
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const html = build()
  if (process.argv.includes('--check')) {
    if (readFileSync(outPath, 'utf-8') !== html) {
      console.error('RadioGridXL.html is out of date with src/. Edit src/, not RadioGridXL.html, then run: npm run build')
      process.exit(1)
    }
    console.log('RadioGridXL.html matches src/.')
  } else {
    writeFileSync(outPath, html)
    console.log('Built RadioGridXL.html from src/.')
  }
}

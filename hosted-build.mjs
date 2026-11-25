/**
 * What a hosted copy gets on top of the default build, and the full list of
 * files a hosted copy serves. Used by sync-radio-to-marshcity.mjs (marsh.city/
 * radio) and deploy-radio-to-netlify.mjs (radio.marshworks.dev); dev tooling
 * only, never shipped.
 *
 * - A Content-Security-Policy <meta>. GitHub Pages can't send response
 *   headers, so without it the hosted PWA had none (only the Docker server
 *   sends one). The APK build stays without it: 'self' on file:// behaves
 *   inconsistently across WebViews.
 * - A content hash in sw.js's cache name. sw.js is cache-first, so installed
 *   apps only see new HTML when sw.js's bytes change; stamping the hash makes
 *   any change to the shell roll the cache, version bump or not.
 */
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

// Shell files served by name beside the app. The built HTML is served as
// index.html, and sw.js comes last, stamped with a hash of all the others.
export const SHELL_FILES = ['manifest.json', 'icon.svg', 'icon-192.png', 'icon-512.png']

// The feedback page the settings QR opens: its own static page beside the
// app, never part of the cached shell (sw.js passes it through).
export const FEEDBACK_PAGE = 'feedback/index.html'

// The licenses page settings names: RadioGrid's GPL notice and the store
// apps' third-party notices. Static like the feedback page, and passed
// through by sw.js the same way.
export const LICENSES_PAGE = 'licenses/index.html'

// The privacy policy the store listings link to. Static like the licenses
// page, and passed through by sw.js the same way.
export const PRIVACY_PAGE = 'privacy/index.html'

// The Android app's Digital Asset Links statement. Chrome opens the app with
// no URL bar only when the site vouches for the app's signing key here.
// Served at /.well-known/ by the radio.marshworks.dev copy only: the moved
// build at marsh.city/radio is no app's home.
export const ASSETLINKS = 'twa/assetlinks.json'
export const ASSETLINKS_PATH = '.well-known/assetlinks.json'

// Everything in this repo a hosted copy is built from. src/ and build.mjs
// make RadioGridXL.html; npm test would catch a src/ edit that was never
// rebuilt, but this names the files instead.
export const SHIPPED_INPUTS = ['RadioGridXL.html', 'src', 'build.mjs', 'profiles', 'sw.js', ...SHELL_FILES, 'feedback', 'licenses', 'privacy', 'guide', 'build-profile.mjs', 'hosted-build.mjs', ASSETLINKS]

/**
 * Every file a hosted copy serves, as [{ name, data }] with names relative to
 * the copy's root: the built default profile (dist/RadioGridXL.html, which
 * the caller builds first) as index.html with the CSP, the shell files, the
 * feedback, licenses and privacy pages, the Android app's assetlinks.json (not in the moved build),
 * then sw.js stamped with a hash of the shell. `moved` marks
 * the HTML as the old address's last build (markMoved). The feedback,
 * licenses and privacy pages aren't in the hash: sw.js never caches them.
 */
export async function hostedFiles(repo, { moved = false } = {}) {
  const built = injectCsp(await readFile(join(repo, 'dist', 'RadioGridXL.html'), 'utf8'))
  const shell = [{ name: 'index.html', data: moved ? markMoved(built) : built }]
  for (const name of SHELL_FILES) shell.push({ name, data: await readFile(join(repo, name)) })
  const feedback = { name: FEEDBACK_PAGE, data: await readFile(join(repo, FEEDBACK_PAGE)) }
  const licenses = { name: LICENSES_PAGE, data: await readFile(join(repo, LICENSES_PAGE)) }
  const privacy = { name: PRIVACY_PAGE, data: await readFile(join(repo, PRIVACY_PAGE)) }
  const sw = { name: 'sw.js', data: stampCacheVersion(await readFile(join(repo, 'sw.js'), 'utf8'), shell) }
  const appLinks = moved ? [] : [{ name: ASSETLINKS_PATH, data: await readFile(join(repo, ASSETLINKS)) }]
  return [...shell, feedback, licenses, privacy, ...appLinks, sw]
}

/* server.js's policy, minus frame-ancestors (browsers ignore it in a meta
   tag; GitHub Pages can't send it as a header). tests/hosted-build.test.mjs
   keeps the two in step. */
export const HOSTED_CSP = [
  "default-src 'self'",
  "object-src 'none'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  'media-src http: https: blob:',
  "connect-src 'self' https://*.api.radio-browser.info",
  'frame-src https://marsh.city',
  "base-uri 'none'",
  "form-action 'none'",
].join('; ')

const CHARSET = '<meta charset="UTF-8">'

// Where the radio lives now. The last build at marsh.city/radio says so.
export const MOVED_TO = 'radio.marshworks.dev'
export const MOVED_META = `<meta name="radiogrid-moved" content="${MOVED_TO}">`

/** Whether the page's <head> holds the moved mark. Only the head: the app's
    own script names the tag too, to look for it. */
export function isMarkedMoved(html) {
  const end = html.indexOf('</head>')
  return /<meta name="radiogrid-moved"/.test(end < 0 ? html : html.slice(0, end))
}

/** The HTML marked as the moved build for the old address: the app then shows
    where the radio went instead of its stations (src/app/24-moved.js). */
export function markMoved(html) {
  if (!html.includes(CHARSET)) throw new Error(`hosted build: ${CHARSET} not found, so the moved mark has nowhere to go`)
  if (isMarkedMoved(html)) throw new Error('hosted build: the HTML is already marked moved')
  return html.replace(CHARSET, () => `${CHARSET}\n${MOVED_META}`)
}

/** The HTML with the CSP meta tag placed right after the charset, ahead of
    every style and script (a meta CSP only covers what follows it). */
export function injectCsp(html) {
  if (!html.includes(CHARSET)) throw new Error(`hosted build: ${CHARSET} not found, so the CSP has nowhere to go`)
  if (html.includes('http-equiv="Content-Security-Policy"')) throw new Error('hosted build: the HTML already has a CSP meta tag')
  // A function replacer, so a $ in the policy is never read as a replacement pattern.
  return html.replace(CHARSET, () => `${CHARSET}\n<meta http-equiv="Content-Security-Policy" content="${HOSTED_CSP}">`)
}

const CACHE_LINE = /const CACHE_VERSION = '(rgxl-shell-[0-9]+\.[0-9]+\.[0-9]+)';/

/** sw.js with an 8-hex-digit hash of the shell files appended to its cache
    name: rgxl-shell-7.7.0 becomes rgxl-shell-7.7.0-1a2b3c4d. The rgxl-shell-
    prefix stays, so activate still finds and deletes old versions.
    `files` is [{ name, data }], hashed in the order given. */
export function stampCacheVersion(swSource, files) {
  if (!CACHE_LINE.test(swSource)) throw new Error("hosted build: no \"const CACHE_VERSION = 'rgxl-shell-x.y.z';\" line in sw.js")
  const hash = createHash('sha256')
  for (const { name, data } of files) hash.update(name).update('\0').update(data).update('\0')
  const digest = hash.digest('hex').slice(0, 8)
  return swSource.replace(CACHE_LINE, (_, version) => `const CACHE_VERSION = '${version}-${digest}';`)
}

/** The cache name in a sw.js source, or null. */
export function cacheVersionOf(swSource) {
  const m = swSource.match(/const CACHE_VERSION = '([^']+)'/)
  return m ? m[1] : null
}

/** The app version in the settings footer of a built HTML file, or null.
    Builds before v7.24.0 say RadioGridXL there, and marsh.city may still hold one. */
export function appVersionOf(html) {
  const m = html.match(/id="settings-version"[^>]*>RadioGrid(?:XL)? v([0-9.]+)</)
  return m ? m[1] : null
}

/**
 * Whether a release needs its own Updates entry on the marsh.city project
 * page: minor and major releases (7.18.0, 8.0.0) do, patches (7.17.1) don't.
 * Each entry is a public claim nobody re-checks, so patches ride on their
 * minor's entry. A version that doesn't parse needs one (fail closed).
 */
export function releaseNeedsUpdatesEntry(version) {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(version ?? '')
  return !m || m[3] === '0'
}

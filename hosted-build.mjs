/**
 * What the hosted copy (marsh.city/radio) gets on top of the default build.
 * Used by sync-radio-to-marshcity.mjs; dev tooling only, never shipped.
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

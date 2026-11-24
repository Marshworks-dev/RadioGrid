import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { join, dirname, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PORT = process.env.PORT || 3900

// Static PWA assets served alongside the app shell. Matched against an explicit
// allowlist keyed by request path — we never derive a filesystem path from the
// URL, so there's no path-traversal surface. Anything not listed falls through
// to the HTML (single-page kiosk).
const STATIC = {
  '/manifest.json': { file: 'manifest.json', type: 'application/manifest+json; charset=utf-8' },
  '/sw.js':         { file: 'sw.js',         type: 'application/javascript; charset=utf-8', noCache: true },
  '/icon.svg':      { file: 'icon.svg',      type: 'image/svg+xml; charset=utf-8' },
  '/icon-192.png':  { file: 'icon-192.png',  type: 'image/png' },
  '/icon-512.png':  { file: 'icon-512.png',  type: 'image/png' },
}

// Sent on every response. The app is one inline <style> + one inline <script>,
// so 'unsafe-inline' is required for both; streams are arbitrary third-party
// http(s) URLs (media-src) and the stream browser calls radio-browser.info
// (connect-src; 'self' too, since sw.js inherits this CSP and fetches the shell).
// frame-ancestors blocks clickjacking the settings panel. frame-src lets the
// settings "How to use this app" overlay frame the guide (PROFILE.helpUrl).
// object-src 'none' because the app has no <object>/<embed>; left to
// default-src, 'self' would still allow them.
const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': [
    "default-src 'self'",
    "object-src 'none'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    'media-src http: https: blob:',
    "connect-src 'self' https://*.api.radio-browser.info",
    'frame-src https://marsh.city',
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; '),
}

// sw.js is cache-first, so an installed app only sees new HTML when sw.js's
// bytes change. Stamp its cache name with a hash of the shell files (as the
// hosted build does) so any change to the HTML reaches installed apps, version
// bump or not: rgxl-shell-7.17.0 becomes rgxl-shell-7.17.0-1a2b3c4d.
const SHELL_FILES = ['RadioGridXL.html', 'manifest.json', 'icon.svg', 'icon-192.png', 'icon-512.png']
const CACHE_LINE = /const CACHE_VERSION = '(rgxl-shell-[0-9]+\.[0-9]+\.[0-9]+)';/

async function stampedServiceWorker(swSource) {
  const hash = createHash('sha256')
  for (const name of SHELL_FILES) {
    try {
      hash.update(name).update('\0').update(await readFile(join(__dirname, name))).update('\0')
    } catch (err) {
      // A missing file just leaves it out of the hash; the shell still serves.
      console.warn('[server] sw.js stamp: skipped ' + name + ': ' + err.code)
    }
  }
  const digest = hash.digest('hex').slice(0, 8)
  return swSource.replace(CACHE_LINE, (_, version) => `const CACHE_VERSION = '${version}-${digest}';`)
}

function send(res, status, headers, body) {
  res.writeHead(status, { ...SECURITY_HEADERS, ...headers })
  res.end(body)
}

const server = createServer(async (req, res) => {
  // Strip query string so '/manifest.json?v=1' still matches. A malformed
  // percent-escape makes decodeURIComponent throw; inside this async handler
  // that was an unhandled rejection that killed the process — reject it instead.
  let path
  try {
    path = normalize(decodeURIComponent((req.url || '/').split('?')[0]))
  } catch (err) {
    send(res, 400, { 'Content-Type': 'text/plain' }, 'Bad request')
    return
  }

  const asset = STATIC[path]
  if (asset) {
    try {
      let body = await readFile(join(__dirname, asset.file))
      if (path === '/sw.js') body = await stampedServiceWorker(body.toString('utf8'))
      const headers = { 'Content-Type': asset.type }
      // sw.js must never be cached by the browser, or shell updates stall.
      if (asset.noCache) headers['Cache-Control'] = 'no-cache, no-store, must-revalidate'
      send(res, 200, headers, body)
      return
    } catch (err) {
      send(res, 404, { 'Content-Type': 'text/plain' }, 'Not found')
      return
    }
  }

  // Everything else serves the app shell.
  try {
    const html = await readFile(join(__dirname, 'RadioGridXL.html'), 'utf8')
    send(res, 200, { 'Content-Type': 'text/html; charset=utf-8' }, html)
  } catch (err) {
    console.error('[server] failed to read RadioGridXL.html:', err.message)
    send(res, 500, { 'Content-Type': 'text/plain' }, 'Failed to load RadioGridXL.html')
  }
})

// All interfaces, so the Docker container's published port reaches it.
server.listen(PORT, '0.0.0.0', () => {
  console.log(`RadioGridXL serving on http://0.0.0.0:${PORT}`)
})

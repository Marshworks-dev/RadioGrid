#!/usr/bin/env node
/**
 * Checks the hosted app at radio.marshworks.dev serves what a listener needs:
 * the page compressed, with its CSP, no script the host added, and without the
 * moved mark (that build is only for the old address, marsh.city/radio), a service worker whose cache name carries
 * the page's version (a half-finished deploy shows as a mismatch), the
 * manifest, the feedback and licences pages and the icon. Read-only GETs, cache-busted.
 * Run daily by .github/workflows/live.yml, and after a deploy with
 * --expect-version, which also requires the live version to be package.json's.
 * Run with: node smoke-live.mjs [--base URL] [--expect-version [x.y.z]]
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const BASE = 'https://radio.marshworks.dev';
const TIMEOUT_MS = 15000;
const ANDROID_PACKAGE = 'dev.marshworks.radiogrid';
const UA = 'RadioGrid-LiveSmoke/1.0 (+https://radio.marshworks.dev/)';

/** GET one path; resolves { resp, body } or { error }. Never throws. */
async function get(base, path, { fetch, timeoutMs }) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const url = `${base}/${path}${path.includes('?') ? '&' : '?'}cb=${Date.now()}`;
    const resp = await fetch(url, { signal: ctl.signal, cache: 'no-store', headers: { 'User-Agent': UA, 'Accept-Encoding': 'gzip, br' } });
    return { resp, body: await resp.text() };
  } catch (err) {
    return { error: ctl.signal.aborted ? `no answer within ${timeoutMs / 1000} s` : (err && err.message) || String(err) };
  } finally {
    clearTimeout(timer);
  }
}

/** Run every check against `base`. Resolves { version, failures }. */
export async function checkLive(base = BASE, { fetch = globalThis.fetch, expectVersion = null, timeoutMs = TIMEOUT_MS } = {}) {
  const failures = [];
  const fail = (msg) => failures.push(msg);
  const opts = { fetch, timeoutMs };

  const page = await get(base, '', opts);
  let version = null;
  if (page.error) fail(`app page: ${page.error}`);
  else if (!page.resp.ok) fail(`app page: HTTP ${page.resp.status}`);
  else {
    const type = page.resp.headers.get('content-type') || '';
    if (!type.startsWith('text/html')) fail(`app page: content type ${type || 'missing'}, not text/html`);
    const encoding = page.resp.headers.get('content-encoding') || '';
    if (!/^(gzip|br|zstd)$/.test(encoding)) fail(`app page: not compressed (content-encoding ${encoding || 'missing'})`);
    if (!page.body.includes('http-equiv="Content-Security-Policy"')) fail('app page: no CSP meta tag');
    // The head only: the app's own script names the tag too (hosted-build.mjs isMarkedMoved).
    const head = page.body.slice(0, Math.max(0, page.body.indexOf('</head>')));
    if (/<meta name="radiogrid-moved"/.test(head)) fail('app page: this is the moved build for marsh.city/radio, not a radio');
    // The app ships one inline script and no other. A <script src> means the
    // host injected one (Netlify's free-tier badge did: /.netlify/scripts/hud).
    const injected = page.body.match(/<script\b[^>]*\bsrc=["']?([^"' >]+)/i);
    if (injected) fail(`app page: the host added a script (${injected[1]}); the app ships none`);
    // Builds before v7.24.0 say RadioGridXL.
    version = (page.body.match(/RadioGrid(?:XL)? v([0-9]+\.[0-9]+\.[0-9]+)/) || [])[1] || null;
    if (!version) fail('app page: no "RadioGrid vX.Y.Z" version string');
    else if (expectVersion && version !== expectVersion) fail(`app page: live version is ${version}, expected ${expectVersion}`);
  }

  const sw = await get(base, 'sw.js', opts);
  if (sw.error) fail(`sw.js: ${sw.error}`);
  else if (!sw.resp.ok) fail(`sw.js: HTTP ${sw.resp.status}`);
  else {
    const cache = (sw.body.match(/const CACHE_VERSION = 'rgxl-shell-([0-9]+\.[0-9]+\.[0-9]+)-[0-9a-f]+';/) || [])[1];
    if (!cache) fail('sw.js: no hosted CACHE_VERSION line (rgxl-shell-x.y.z-hash)');
    else if (version && cache !== version) fail(`sw.js: cache is for ${cache} but the page is ${version} (half-finished deploy?)`);
  }

  const manifest = await get(base, 'manifest.json', opts);
  if (manifest.error) fail(`manifest.json: ${manifest.error}`);
  else if (!manifest.resp.ok) fail(`manifest.json: HTTP ${manifest.resp.status}`);
  else {
    try { JSON.parse(manifest.body); } catch { fail('manifest.json: not valid JSON'); }
  }

  const feedback = await get(base, 'feedback/', opts);
  if (feedback.error) fail(`feedback page: ${feedback.error}`);
  else if (!feedback.resp.ok) fail(`feedback page: HTTP ${feedback.resp.status}`);

  const licences = await get(base, 'licences/', opts);
  if (licences.error) fail(`licences page: ${licences.error}`);
  else if (!licences.resp.ok) fail(`licences page: HTTP ${licences.resp.status}`);

  const icon = await get(base, 'icon-192.png', opts);
  if (icon.error) fail(`icon-192.png: ${icon.error}`);
  else if (!icon.resp.ok) fail(`icon-192.png: HTTP ${icon.resp.status}`);
  else if (!(icon.resp.headers.get('content-type') || '').startsWith('image/png')) fail('icon-192.png: not served as image/png');

  // The Android app opens without a URL bar only while this vouches for it.
  const links = await get(base, '.well-known/assetlinks.json', opts);
  if (links.error) fail(`assetlinks.json: ${links.error}`);
  else if (!links.resp.ok) fail(`assetlinks.json: HTTP ${links.resp.status}, so the Android app opens with a URL bar`);
  else {
    if (!(links.resp.headers.get('content-type') || '').startsWith('application/json')) fail('assetlinks.json: not served as application/json');
    let statements = null;
    try { statements = JSON.parse(links.body); } catch { fail('assetlinks.json: not valid JSON'); }
    if (statements && !(Array.isArray(statements) && statements.some((st) => st?.target?.package_name === ANDROID_PACKAGE && st.target.sha256_cert_fingerprints?.length))) {
      fail(`assetlinks.json: no fingerprint for ${ANDROID_PACKAGE}`);
    }
  }

  return { version, failures };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const at = (flag) => args.indexOf(flag);
  const base = (at('--base') >= 0 ? args[at('--base') + 1] : process.env.SMOKE_BASE_URL || BASE).replace(/\/$/, '');
  let expectVersion = null;
  if (at('--expect-version') >= 0) {
    const given = args[at('--expect-version') + 1];
    expectVersion = given && !given.startsWith('--') ? given
      : JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'package.json'), 'utf-8')).version;
  }
  const { version, failures } = await checkLive(base, { expectVersion });
  for (const f of failures) console.error(`FAIL  ${f}`);
  console.log(failures.length ? `${failures.length} live check(s) failed at ${base}.` : `${base} serves v${version}, all checks pass.`);
  process.exit(failures.length ? 1 : 0);
}

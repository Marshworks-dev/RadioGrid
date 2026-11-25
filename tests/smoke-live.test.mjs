/**
 * The live-site check (smoke-live.mjs) against a fake radio.marshworks.dev. The
 * real GETs run daily in .github/workflows/live.yml and after each deploy.
 * Run with: npm run test:dom
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkLive } from '../smoke-live.mjs';

const BASE = 'https://site.example/radio';

/** A healthy hosted copy of v7.22.0; `over` replaces one path's response. */
function site(over = {}) {
  const pages = {
    '': { type: 'text/html; charset=utf-8', encoding: 'gzip', body: '<meta http-equiv="Content-Security-Policy" content="x"><span>RadioGridXL v7.22.0</span>' },
    'sw.js': { type: 'text/javascript', body: "const CACHE_VERSION = 'rgxl-shell-7.22.0-abc123';" },
    'manifest.json': { type: 'application/json', body: '{"name":"RadioGridXL"}' },
    'feedback/': { type: 'text/html', body: '<h1>Feedback</h1>' },
    'icon-192.png': { type: 'image/png', body: 'PNG' },
    '.well-known/assetlinks.json': { type: 'application/json', body: '[{"relation":["delegate_permission/common.handle_all_urls"],"target":{"namespace":"android_app","package_name":"dev.marshworks.radiogrid","sha256_cert_fingerprints":["AB"]}}]' },
    ...over,
  };
  const seen = [];
  const fetch = async (url) => {
    seen.push(url);
    const path = url.slice(BASE.length + 1).replace(/[?&]cb=\d+$/, '');
    const p = pages[path];
    if (p instanceof Error) throw p;
    if (!p) return { ok: false, status: 404, headers: new Headers(), text: async () => '' };
    const headers = new Headers({ 'content-type': p.type });
    if (p.encoding) headers.set('content-encoding', p.encoding);
    const status = p.status || 200;
    return { ok: status < 300, status, headers, text: async () => p.body };
  };
  return { fetch, seen };
}

test('a healthy site passes and reports its version', async () => {
  const { fetch, seen } = site();
  assert.deepEqual(await checkLive(BASE, { fetch }), { version: '7.22.0', failures: [] });
  assert.ok(seen.every((u) => /[?&]cb=\d+$/.test(u)), 'every request is cache-busted');
});

test('a copy from after the rename reads as RadioGrid and passes', async () => {
  const { fetch } = site({
    '': { type: 'text/html', encoding: 'gzip', body: '<meta http-equiv="Content-Security-Policy" content="x"><span>RadioGrid v7.24.0</span>' },
    'sw.js': { type: 'text/javascript', body: "const CACHE_VERSION = 'rgxl-shell-7.24.0-abc123';" },
  });
  assert.deepEqual(await checkLive(BASE, { fetch, expectVersion: '7.24.0' }), { version: '7.24.0', failures: [] });
});

test('--expect-version passes on a match and fails on an older live copy', async () => {
  assert.deepEqual((await checkLive(BASE, { fetch: site().fetch, expectVersion: '7.22.0' })).failures, []);
  const { failures } = await checkLive(BASE, { fetch: site().fetch, expectVersion: '7.23.0' });
  assert.deepEqual(failures, ['app page: live version is 7.22.0, expected 7.23.0']);
});

test('an uncompressed page fails', async () => {
  const { failures } = await checkLive(BASE, { fetch: site({ '': { type: 'text/html', body: '<meta http-equiv="Content-Security-Policy"> RadioGridXL v7.22.0' } }).fetch });
  assert.deepEqual(failures, ['app page: not compressed (content-encoding missing)']);
});

test('the moved build served at the new address fails — unhappy path', async () => {
  const moved = '<head><meta charset="UTF-8">\n<meta name="radiogrid-moved" content="radio.marshworks.dev"><meta http-equiv="Content-Security-Policy" content="x"></head><span>RadioGrid v7.25.0</span>';
  const { failures } = await checkLive(BASE, { fetch: site({ '': { type: 'text/html', encoding: 'gzip', body: moved }, 'sw.js': { type: 'text/javascript', body: "const CACHE_VERSION = 'rgxl-shell-7.25.0-abc123';" } }).fetch });
  assert.deepEqual(failures, ['app page: this is the moved build for marsh.city/radio, not a radio']);
});

test('the app\'s own script naming the tag is not mistaken for the mark', async () => {
  const page = '<head><meta http-equiv="Content-Security-Policy" content="x"></head><span>RadioGrid v7.22.0</span><script>document.querySelector(\'meta[name="radiogrid-moved"]\')</script>';
  const { failures } = await checkLive(BASE, { fetch: site({ '': { type: 'text/html', encoding: 'gzip', body: page } }).fetch });
  assert.deepEqual(failures, []);
});

test('a script the host injected fails, as Netlify\'s free-tier badge did — unhappy path', async () => {
  const page = '<meta http-equiv="Content-Security-Policy" content="x"><span>RadioGrid v7.22.0</span><script async src="/.netlify/scripts/hud?variant=public" data-account-tier="free"></script>';
  const { failures } = await checkLive(BASE, { fetch: site({ '': { type: 'text/html', encoding: 'gzip', body: page } }).fetch });
  assert.deepEqual(failures, ['app page: the host added a script (/.netlify/scripts/hud?variant=public); the app ships none']);
});

test('a page without its CSP fails', async () => {
  const { failures } = await checkLive(BASE, { fetch: site({ '': { type: 'text/html', encoding: 'br', body: 'RadioGridXL v7.22.0' } }).fetch });
  assert.deepEqual(failures, ['app page: no CSP meta tag']);
});

test('a service worker cached for another version fails as a half-finished deploy', async () => {
  const { failures } = await checkLive(BASE, { fetch: site({ 'sw.js': { type: 'text/javascript', body: "const CACHE_VERSION = 'rgxl-shell-7.21.1-def456';" } }).fetch });
  assert.deepEqual(failures, ['sw.js: cache is for 7.21.1 but the page is 7.22.0 (half-finished deploy?)']);
});

test('the repo\'s unhashed service worker fails: the hosted build was skipped', async () => {
  const { failures } = await checkLive(BASE, { fetch: site({ 'sw.js': { type: 'text/javascript', body: "const CACHE_VERSION = 'rgxl-shell-7.22.0';" } }).fetch });
  assert.deepEqual(failures, ['sw.js: no hosted CACHE_VERSION line (rgxl-shell-x.y.z-hash)']);
});

test('missing sidecars, a broken manifest and a wrong icon type each fail by name', async () => {
  const { failures } = await checkLive(BASE, { fetch: site({
    'manifest.json': { type: 'application/json', body: '{not json' },
    'feedback/': undefined,
    'icon-192.png': { type: 'text/html', body: '<html>' },
  }).fetch });
  assert.deepEqual(failures, ['manifest.json: not valid JSON', 'feedback page: HTTP 404', 'icon-192.png: not served as image/png']);
});

test('a site that is down fails every check without throwing', async () => {
  const down = async () => { throw new Error('getaddrinfo ENOTFOUND'); };
  const { version, failures } = await checkLive(BASE, { fetch: down });
  assert.equal(version, null);
  assert.equal(failures.length, 6);
  assert.ok(failures.every((f) => f.endsWith('getaddrinfo ENOTFOUND')));
});

test('a request that hangs fails on the timeout', async () => {
  const hang = (url, { signal }) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('aborted'))));
  const { failures } = await checkLive(BASE, { fetch: hang, timeoutMs: 20 });
  assert.equal(failures[0], 'app page: no answer within 0.02 s');
});

test('a missing or wrong assetlinks.json fails, since the Android app would open with a URL bar — unhappy path', async () => {
  const missing = await checkLive(BASE, { fetch: site({ '.well-known/assetlinks.json': undefined }).fetch });
  assert.deepEqual(missing.failures, ['assetlinks.json: HTTP 404, so the Android app opens with a URL bar']);
  const html = await checkLive(BASE, { fetch: site({ '.well-known/assetlinks.json': { type: 'text/html', body: '<h1>Page not found</h1>' } }).fetch });
  assert.deepEqual(html.failures, ['assetlinks.json: not served as application/json', 'assetlinks.json: not valid JSON']);
  const other = await checkLive(BASE, { fetch: site({ '.well-known/assetlinks.json': { type: 'application/json', body: '[{"target":{"package_name":"com.example"}}]' } }).fetch });
  assert.deepEqual(other.failures, ['assetlinks.json: no fingerprint for dev.marshworks.radiogrid']);
});

/**
 * PROMISES.md: "Nothing about you, your stations or your listening leaves the
 * device. The only outside requests are the stream you play, station
 * searches the setter-up runs on Radio Browser, and the how-to guide when
 * someone opens it."
 *
 * Two layers. The hosted CSP, matched exactly, is what the browser enforces.
 * A real Chromium run then walks every screen (walkEverything in
 * browser-harness.mjs) with no CSP at all and the service worker running, and
 * every request attempted from any frame or the worker must be one the
 * promise allows: Radio Browser only on the paths the app uses, media only at
 * a stream address the radio holds, offers or was given.
 * Breakers live in tests/promise-breakers.mjs; tests/promises.test.mjs runs
 * them. Needs Chromium: npx playwright install chromium.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HOSTED_CSP } from '../hosted-build.mjs';
import { readFileSync } from 'node:fs';
import { openApp, walkEverything, shelfUrls, APP_ORIGIN, RB_HOST, FIXTURE_STREAM } from './browser-harness.mjs';

const profileStreamUrls = () => JSON.parse(readFileSync(new URL('../profiles/default.json', import.meta.url), 'utf-8')).streams.map((s) => s.url);

/** The CSP as { directive: [sources] }. */
function parseCsp(csp) {
  return Object.fromEntries(csp.split(';').map((d) => d.trim().split(/\s+/)).filter((p) => p[0]).map(([k, ...v]) => [k, v]));
}

test('the hosted CSP allows exactly: own origin, Radio Browser for searches, marsh.city for the guide frame, any stream', () => {
  assert.deepEqual(parseCsp(HOSTED_CSP), {
    'default-src': ["'self'"],
    'object-src': ["'none'"],
    'script-src': ["'self'", "'unsafe-inline'"],
    'style-src': ["'self'", "'unsafe-inline'"],
    'img-src': ["'self'", 'data:'],
    'media-src': ['http:', 'https:', 'blob:'],
    'connect-src': ["'self'", 'https://*.api.radio-browser.info'],
    'frame-src': ['https://marsh.city'],
    'base-uri': ["'none'"],
    'form-action': ["'none'"],
  });
});

/** The only Radio Browser calls the app makes: the mirror list, station
    searches, and the country and region lists. Anything else on those hosts
    (the directory's click counter, /json/url/<id>, is the obvious one) would
    tell the directory what the radio plays. */
const RB_PATHS = [/^\/json\/servers$/, /^\/json\/stations\/search$/, /^\/json\/countries$/, /^\/json\/states\/[^/]+\/?$/];

test('walking the whole app, every request goes only where the promise allows', async () => {
  const { page, context, requests, close } = await openApp({ serviceWorkers: 'allow' });
  try {
    // Every stream address the radio held at any point, read before and after
    // the walk: a media request must be one of these exactly, so nothing rides
    // along in a stream's query string.
    const configured = async () => page.evaluate(() => {
      const c = JSON.parse(localStorage.getItem('rgxl_cfg') || 'null');
      return c ? c.streams.map((s) => s.url) : [];
    });
    const defaults = await page.evaluate(() => [...document.querySelectorAll('.stream-btn')].length);
    assert.ok(defaults > 0, 'the radio shows its stations');
    const streams = new Set([FIXTURE_STREAM, ...shelfUrls(), ...profileStreamUrls()].map((u) => new URL(u).href));

    // Let the service worker take over, so the walk's page loads go through it.
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.waitForFunction(() => !!navigator.serviceWorker.controller);
    await walkEverything(page, context, async () => {});
    assert.ok(await page.evaluate(() => !!navigator.serviceWorker.controller), 'the service worker controlled the page');
    for (const u of await configured()) streams.add(new URL(u).href);

    const bad = requests.filter(({ url, type, mainFrame, sw }) => {
      const u = new URL(url);
      if (u.protocol === 'data:' || u.protocol === 'blob:' || u.protocol === 'about:') return false;
      if (u.origin === APP_ORIGIN) return false;
      if (sw) return true; // the service worker only ever fetches the app's own files
      if (RB_HOST.test(u.hostname) && (type === 'fetch' || type === 'xhr') && RB_PATHS.some((p) => p.test(u.pathname))) return false;
      if (type === 'media' && streams.has(u.href)) return false;
      // The guide: only the guide address, only as a frame document, never from the main frame.
      if (u.hostname === 'marsh.city' && type === 'document' && !mainFrame && url.startsWith('https://marsh.city/embed/guides/')) return false;
      return true;
    });
    assert.deepEqual(bad.map((r) => `${r.sw ? 'service worker ' : ''}${r.type} ${r.url}`), [], 'requests the promise does not allow');

    // The walk really happened, so a clean list means something.
    const paths = requests.map((r) => new URL(r.url));
    assert.ok(paths.some((u) => RB_HOST.test(u.hostname) && u.pathname === '/json/stations/search'), 'a search reached Radio Browser');
    assert.ok(paths.some((u) => RB_HOST.test(u.hostname) && u.pathname.startsWith('/json/states/')), 'the region list was fetched');
    assert.ok(paths.some((u) => u.hostname === 'stream.example'), 'the added station was played');
    assert.ok(requests.some((r) => r.type === 'media' && shelfUrls().includes(r.url)), 'a shelf station was previewed');
    assert.ok(paths.some((u) => u.hostname === 'marsh.city'), 'the guide was opened');
    assert.ok(requests.some((r) => r.sw), 'the service worker ran and fetched');
  } finally {
    await close();
  }
});

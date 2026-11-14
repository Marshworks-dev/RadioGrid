/**
 * Real-browser harness for the promise checks (tests/promise-*.test.mjs):
 * the things jsdom can't see, such as network requests and running
 * animations. Chromium via Playwright (already a dev dependency for the
 * guide screenshots).
 *
 * Every request the page makes is intercepted, so nothing reaches the real
 * network and no local port is needed. The app is served as
 * https://radio.test/ straight from this repo's files (no CSP injected, so a
 * request the hosted CSP would block still shows up here as an attempt).
 * Radio Browser, streams and marsh.city get canned answers; anything else is
 * recorded and aborted.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { chromium } from 'playwright';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
export const APP_ORIGIN = 'https://radio.test';
export const RB_HOST = /^[a-z0-9-]+(\.[a-z0-9-]+)*\.api\.radio-browser\.info$/i;

// One directory hit for any search: an https stream on a host of its own.
export const FIXTURE_STREAM = 'https://stream.example/jazz.mp3';
// The country picker asks for the directory's country names, then that
// country's regions.
const FIXTURE_COUNTRIES = [{ name: 'The United States Of America', iso_3166_1: 'US', stationcount: 5 }];
const FIXTURE_STATES = [{ name: 'Minnesota', country: 'The United States Of America', stationcount: 50 }];
const FIXTURE_STATIONS = [{
  name: 'Test Jazz FM', url: FIXTURE_STREAM, url_resolved: FIXTURE_STREAM, stationuuid: 'u1',
  country: 'United States', countrycode: 'US', state: 'Minnesota', language: 'english',
  tags: 'jazz', codec: 'MP3', bitrate: 128, lastcheckok: 1, clickcount: 10,
}];

const FILES = {
  '/': ['RadioGridXL.html', 'text/html'],
  '/index.html': ['RadioGridXL.html', 'text/html'],
  '/manifest.json': ['manifest.json', 'application/manifest+json'],
  '/sw.js': ['sw.js', 'text/javascript'],
  '/icon.svg': ['icon.svg', 'image/svg+xml'],
  '/icon-192.png': ['icon-192.png', 'image/png'],
  '/icon-512.png': ['icon-512.png', 'image/png'],
};

/** Launch Chromium with the app routed in. Returns the page, every request
    it made (all frames, beacons included) and a close(). `initScript` runs
    in every page before the app's own script, on every load. */
export async function openApp({ reducedMotion = 'no-preference', viewport = { width: 1024, height: 900 }, serviceWorkers = 'block', initScript } = {}) {
  const browser = await chromium.launch();
  // serviceWorkers 'allow' lets sw.js install and run; Chromium routes its
  // fetches through context.route too, so they're recorded with sw: true.
  const context = await browser.newContext({ viewport, reducedMotion, serviceWorkers });
  if (initScript) await context.addInitScript(initScript);
  const requests = [];
  context.on('request', (req) => {
    const sw = !!req.serviceWorker(); // frame() throws for a worker's request
    const mainFrame = !sw && req.frame() === req.frame().page().mainFrame();
    requests.push({ url: req.url(), type: req.resourceType(), mainFrame, sw });
  });
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.origin === APP_ORIGIN && FILES[url.pathname]) {
      const [file, contentType] = FILES[url.pathname];
      return route.fulfill({ status: 200, contentType, body: readFileSync(join(repo, file)) });
    }
    if (RB_HOST.test(url.hostname)) {
      if (url.pathname === '/json/servers') return route.fulfill({ json: [{ name: 'de1.api.radio-browser.info' }] });
      if (url.pathname.startsWith('/json/stations/search')) return route.fulfill({ json: FIXTURE_STATIONS });
      if (url.pathname === '/json/countries') return route.fulfill({ json: FIXTURE_COUNTRIES });
      if (url.pathname.startsWith('/json/states/')) return route.fulfill({ json: FIXTURE_STATES });
      return route.fulfill({ json: [] });
    }
    if (url.hostname === 'marsh.city') return route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>Guide</title><p>Guide</p>' });
    if (route.request().resourceType() === 'media') return route.fulfill({ status: 200, contentType: 'audio/mpeg', body: Buffer.alloc(0) });
    return route.abort();
  });
  const page = await context.newPage();
  await page.goto(APP_ORIGIN + '/');
  return { page, context, requests, close: () => browser.close() };
}

/** Open settings the way a person does on a new radio: the Settings button. */
export async function openSettingsByButton(page) {
  await page.click('#settings-btn');
  await page.waitForSelector('#settings-panel.open', { timeout: 5000 });
}

/** The starter-shelf stations, read from the app as check-shelves.mjs does. */
export function shelfUrls() {
  const html = readFileSync(join(repo, 'RadioGridXL.html'), 'utf-8');
  const start = html.indexOf('/* === SHELVES');
  const block = html.slice(html.indexOf('const SHELVES = ', start) + 'const SHELVES = '.length, html.indexOf('/* === END SHELVES === */'));
  return JSON.parse(block.trim().replace(/;$/, '')).flatMap((sh) => sh.stations.map((st) => st.url));
}

/** Click without needing the element on screen (a collapsed section, a
    scrolled list): the same handlers run, which is what the checks are about. */
const tap = (page, selector) => page.locator(selector).first().evaluate((el) => el.click());

/**
 * Every surface the app has, in the order a setter-up and a listener would
 * meet them. `step(name)` runs after each, for a check to look around.
 * Shared by the egress and motion checks so neither can skip a screen the
 * other visits. A new screen goes here.
 */
export async function walkEverything(page, context, step) {
  await step('first load');

  // A PIN on the device, so the Settings button opens the PIN pad: a wrong PIN, then the right one.
  await page.evaluate(() => localStorage.setItem('rgxl_pin', '1234'));
  await page.reload();
  await page.click('#settings-btn');
  await page.waitForSelector('#pin-overlay.visible');
  await step('PIN pad');
  for (const d of '9999') await tap(page, `.pin-key[aria-label="${d}"]`);
  await page.waitForTimeout(300);
  await step('wrong PIN');
  for (const d of '1234') await tap(page, `.pin-key[aria-label="${d}"]`);
  await page.waitForSelector('#settings-panel.open');
  await step('settings open');

  // Settings: a station row, a theme, a preset, the advanced controls.
  await page.locator('.stream-row').first().click();
  await step('station row open');
  await tap(page, '.theme-swatch[data-family="contrast"]');
  await step('theme changed');
  await page.locator('.chip[data-group="preset"]').nth(1).evaluate((el) => el.click());
  await step('preset picked');
  await tap(page, '.chip[data-group="advanced"][data-val="on"]');
  await step('advanced controls on');

  // Hiding the Settings button: the practice dialog, five taps, Done; then
  // the button comes back so the rest of the walk is as before.
  await tap(page, '.s-switch[data-switch="settingsButton"]');
  await page.waitForSelector('#hide-overlay.visible');
  await step('hide the Settings button: practice');
  for (let i = 0; i < 5; i++) await tap(page, '#hide-practice');
  await step('practice passed');
  await tap(page, '#hide-done');
  await step('Settings button hidden');
  await tap(page, '.s-switch[data-switch="settingsButton"]');

  // Preview and back.
  await tap(page, '#settings-preview');
  await step('preview');
  await tap(page, '#preview-back');
  await step('back to settings');

  // The station browser: shelves, a shelf, a station preview, a country and
  // its regions, a search, an add.
  await page.evaluate(() => window.openStreamBrowser());
  await step('station browser');
  await tap(page, '.sb-shelf');
  await step('a shelf');
  await tap(page, '#sb-results .sb-result-play');
  await page.waitForTimeout(300);
  await step('station preview playing');
  await tap(page, '#sb-results .sb-result-play');
  await tap(page, '.sb-back');
  await step('back to shelves');
  await page.selectOption('#sb-country', 'US');
  await page.waitForSelector('#sb-region:not([disabled])', { timeout: 10000 });
  await step('country and regions');
  await page.selectOption('#sb-country', '');
  await page.fill('#sb-search', 'jazz');
  await page.press('#sb-search', 'Enter');
  await page.waitForSelector('#sb-results .sb-result-add', { timeout: 10000 });
  await step('search results');
  await tap(page, '#sb-results .sb-result-add');
  await page.evaluate(() => window.closeStreamBrowser());
  await step('station added');

  // Backup out and back in, and the Reset dialog (cancelled).
  const download = page.waitForEvent('download');
  await tap(page, '.device-btn[onclick="exportConfig()"]');
  const backup = await (await download).createReadStream();
  const chunks = [];
  for await (const c of backup) chunks.push(c);
  await page.setInputFiles('#import-file', { name: 'backup.json', mimeType: 'application/json', buffer: Buffer.concat(chunks) });
  await page.waitForFunction(() => /restored/i.test(document.getElementById('backup-status').textContent));
  await step('backup exported and restored');
  await page.evaluate(() => window.confirmReset());
  await step('reset dialog');
  await page.evaluate(() => window.cancelReset());
  await page.evaluate(() => window.showIdlePrompt()); // what 3 minutes untouched brings up
  await step('"still setting up?" prompt');
  await tap(page, '#idle-overlay button');

  // The guide, opened from settings.
  await tap(page, '#help-btn');
  await page.waitForTimeout(800);
  await step('guide open');
  await page.evaluate(() => window.closeHelp());

  await tap(page, '#apply-btn');
  await page.waitForTimeout(300);
  await step('apply and close');

  // Listening: a default station, the sleep timer, pause, the added station,
  // Wi-Fi lost and back.
  await page.locator('.stream-btn').first().click();
  await page.waitForTimeout(500);
  await step('play');
  await tap(page, '.adv-sleep-btn');
  await step('sleep menu');
  await tap(page, '.sleep-opt');
  await step('sleep timer set');
  await page.locator('.stream-btn').first().click();
  await step('pause');
  await page.locator('.stream-btn').last().click();
  await page.waitForTimeout(800);
  await step('play the added station');
  await context.setOffline(true);
  await page.waitForTimeout(300);
  await step('no network');
  await context.setOffline(false);
  await page.waitForTimeout(500);
  await step('back online');
  await page.waitForTimeout(1500); // anything on a short timer
  await step('settled');
}

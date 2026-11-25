/**
 * Service worker, both halves: sw.js itself, run in node:vm against small
 * fakes of CacheStorage and the network, and the page's registration code,
 * run in jsdom with a fake navigator.serviceWorker (jsdom has none, so the
 * registration guard returned early under test before this file).
 *
 * The fakes keep only what the worker relies on: Cache.add rejects a non-OK
 * response, caches.match searches every cache in creation order, and Request
 * resolves relative URLs against the worker's own URL.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';
import { loadApp } from './harness.mjs';
import { bootPlayback, STREAMS, CONNECT_MS } from './playback-fakes.mjs';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
const SW_SRC = readFileSync(join(repo, 'sw.js'), 'utf-8');
const CACHE_VERSION = SW_SRC.match(/const CACHE_VERSION = '([^']+)'/)[1];

const ORIGIN = 'https://marsh.city';
const SCOPE = ORIGIN + '/radio/';
const SW_URL = SCOPE + 'sw.js';
const STREAM_URL = 'https://stream.radioparadise.com/mellow-128';

// What marsh.city/radio serves: the shell as ./ and ./index.html, no
// RadioGridXL.html (that name is the Docker host's).
const HOSTED_FILES = {
  '': 'shell v1', 'index.html': 'shell v1', 'manifest.json': 'manifest',
  'icon.svg': 'svg', 'icon-192.png': 'png192', 'icon-512.png': 'png512',
};

class FakeRequest {
  constructor(input, init = {}) {
    this.url = new URL(typeof input === 'string' ? input : input.url, SW_URL).href;
    this.method = init.method || 'GET';
    this.mode = init.mode || 'cors';
    this.cache = init.cache || 'default';
  }
}
const toRequest = (r) => (r instanceof FakeRequest ? r : new FakeRequest(r));

function response(body, status = 200) {
  return { body, status, ok: status >= 200 && status < 300, type: 'basic', clone() { return response(body, status); } };
}

/** The network plus CacheStorage. `files` maps a path under SCOPE to a body;
    `online: false` fails every fetch; `dropHtml` fails only the shell HTML,
    like a weak connection timing out on the one big file. */
function makeEnv(files = HOSTED_FILES) {
  const env = { files: { ...files }, online: true, dropHtml: false, fetches: [], store: new Map() };
  env.fetch = async (input) => {
    const req = toRequest(input);
    env.fetches.push({ url: req.url, cache: req.cache });
    if (!env.online) throw new TypeError('Failed to fetch');
    if (!req.url.startsWith(SCOPE)) return response('stream');
    const path = req.url.slice(SCOPE.length);
    if (env.dropHtml && /^(index\.html)?$/.test(path)) throw new TypeError('timeout');
    return path in env.files ? response(env.files[path]) : response('', 404);
  };
  const cacheFor = (entries) => ({
    async add(input) {
      const req = toRequest(input);
      const res = await env.fetch(req);
      if (!res.ok) throw new TypeError('Cache.add: bad response');
      entries.set(req.url, res);
    },
    async put(input, res) { entries.set(toRequest(input).url, res); },
    async match(input) { return entries.get(toRequest(input).url); },
  });
  env.caches = {
    async open(name) { if (!env.store.has(name)) env.store.set(name, new Map()); return cacheFor(env.store.get(name)); },
    async keys() { return [...env.store.keys()]; },
    async delete(name) { return env.store.delete(name); },
    async match(input) {
      const url = toRequest(input).url;
      for (const entries of env.store.values()) if (entries.has(url)) return entries.get(url);
      return undefined;
    },
  };
  return env;
}

/** Evaluate a copy of sw.js against env; returns its event hooks. */
function bootWorker(env, src = SW_SRC) {
  const listeners = {};
  const self = {
    location: new URL(SW_URL),
    skipWaiting() {},
    clients: { claim: async () => {} },
    addEventListener: (type, fn) => { listeners[type] = fn; },
  };
  vm.runInNewContext(src, { self, caches: env.caches, fetch: env.fetch, Request: FakeRequest, URL, Promise, console });
  const lifecycle = (type) => { let p; listeners[type]({ waitUntil: (x) => { p = x; } }); return p; };
  return {
    install: () => lifecycle('install'),
    activate: () => lifecycle('activate'),
    /** Dispatch a fetch event; null means the worker let the browser handle it. */
    fetch(url, init = {}) {
      let responded = null;
      listeners.fetch({ request: new FakeRequest(url, init), respondWith: (p) => { responded = p; } });
      return responded;
    },
  };
}

/** What the browser does with a new worker: install, then activate only if
    install succeeded (a failed install leaves the old worker in charge). */
async function update(env, src) {
  const sw = bootWorker(env, src);
  try { await sw.install(); } catch { return { sw, outcome: 'install-failed' }; }
  await sw.activate();
  return { sw, outcome: 'activated' };
}

const withVersion = (version) => SW_SRC.replace(`'${CACHE_VERSION}'`, `'rgxl-shell-${version}'`);
const cacheUrls = (env, name) => [...(env.store.get(name)?.keys() || [])].map((u) => u.slice(SCOPE.length) || './');

// ── sw.js ────────────────────────────────────────────────────────────────

test('install precaches the shell, and a missing asset does not fail it', async () => {
  const env = makeEnv();
  const { outcome } = await update(env);
  assert.equal(outcome, 'activated');
  assert.deepEqual(cacheUrls(env, CACHE_VERSION).sort(),
    ['./', 'icon-192.png', 'icon-512.png', 'icon.svg', 'index.html', 'manifest.json']);
});

test('streams and other cross-origin requests always go to the network', async () => {
  const env = makeEnv();
  const { sw } = await update(env);
  assert.equal(sw.fetch(STREAM_URL), null);
  assert.equal(sw.fetch('https://de1.api.radio-browser.info/json/stations/search?name=jazz'), null);
});

test('everything the worker itself fetches is on the app\'s own origin (nothing leaves the device)', async () => {
  const env = makeEnv({ ...HOSTED_FILES, 'extra.png': 'extra' });
  const { sw } = await update(env);
  sw.fetch(STREAM_URL);
  sw.fetch('https://de1.api.radio-browser.info/json/stations/search?name=jazz');
  await sw.fetch(SCOPE, { mode: 'navigate' });
  await sw.fetch(SCOPE + 'extra.png');
  await update(env, withVersion('9.9.9'));
  assert.ok(env.fetches.length > 0);
  assert.deepEqual(env.fetches.filter((f) => new URL(f.url).origin !== ORIGIN).map((f) => f.url), []);
});

test('non-GET requests pass straight through', async () => {
  const env = makeEnv();
  const { sw } = await update(env);
  assert.equal(sw.fetch(SCOPE + 'anything', { method: 'POST' }), null);
});

test('the shell is served from the cache, so the app opens offline', async () => {
  const env = makeEnv();
  const { sw } = await update(env);
  env.online = false;
  assert.equal((await sw.fetch(SCOPE, { mode: 'navigate' })).body, 'shell v1');
  assert.equal((await sw.fetch(SCOPE + 'manifest.json')).body, 'manifest');
});

test('an uncached same-origin file is fetched once, then served offline', async () => {
  const env = makeEnv({ ...HOSTED_FILES, 'extra.png': 'extra' });
  const { sw } = await update(env);
  assert.equal((await sw.fetch(SCOPE + 'extra.png')).body, 'extra');
  await new Promise((r) => setImmediate(r)); // the cache.put after the response
  env.online = false;
  assert.equal((await sw.fetch(SCOPE + 'extra.png')).body, 'extra');
});

test('offline, any navigation falls back to the shell under whichever name it was cached', async () => {
  // Docker serves the shell as RadioGridXL.html (and /), not index.html.
  const env = makeEnv({ '': 'docker shell', 'RadioGridXL.html': 'docker shell', 'manifest.json': 'manifest' });
  const { sw } = await update(env);
  env.store.get(CACHE_VERSION).delete(SCOPE); // only the filename entry left
  env.online = false;
  assert.equal((await sw.fetch(SCOPE + '?from=homescreen', { mode: 'navigate' })).body, 'docker shell');
});

test('the feedback page beside the app is left to the browser, online or off, never cached or answered with the shell', async () => {
  const env = makeEnv({ ...HOSTED_FILES, 'feedback/': 'feedback page', 'feedback/index.html': 'feedback page' });
  const { sw } = await update(env);
  for (const path of ['feedback', 'feedback/', 'feedback/index.html', 'feedback/?from=qr']) {
    assert.equal(sw.fetch(SCOPE + path, { mode: 'navigate' }), null, `${path} online`);
  }
  env.online = false;
  // Offline, the browser shows its own "no connection" page, not the radio.
  assert.equal(sw.fetch(SCOPE + 'feedback/', { mode: 'navigate' }), null);
  assert.equal(sw.fetch(SCOPE + 'feedback', { mode: 'navigate' }), null, 'typed without the slash');
  assert.ok(!cacheUrls(env, CACHE_VERSION).some((u) => u.startsWith('feedback')), 'never cached');
});

test('the licenses page beside the app is left to the browser too, never cached or answered with the shell', async () => {
  const env = makeEnv({ ...HOSTED_FILES, 'licenses/': 'licenses page', 'licenses/index.html': 'licenses page' });
  const { sw } = await update(env);
  for (const path of ['licenses', 'licenses/', 'licenses/index.html']) {
    assert.equal(sw.fetch(SCOPE + path, { mode: 'navigate' }), null, `${path} online`);
  }
  env.online = false;
  assert.equal(sw.fetch(SCOPE + 'licenses/', { mode: 'navigate' }), null);
  assert.ok(!cacheUrls(env, CACHE_VERSION).some((u) => u.startsWith('licenses')), 'never cached');
});

test('a look-alike path such as feedbackx/ still gets the shell offline — unhappy path', async () => {
  const env = makeEnv();
  const { sw } = await update(env);
  env.online = false;
  assert.equal((await sw.fetch(SCOPE + 'feedbackx', { mode: 'navigate' })).body, 'shell v1');
});

test('offline, a missing non-navigation request fails rather than getting the shell', async () => {
  const env = makeEnv();
  const { sw } = await update(env);
  env.online = false;
  assert.equal(await sw.fetch(SCOPE + 'nope.png'), undefined);
});

test('a new version replaces the previous radio cache', async () => {
  const env = makeEnv();
  await update(env, withVersion('7.5.5'));
  env.files[''] = env.files['index.html'] = 'shell v2';
  await update(env);
  assert.deepEqual([...env.store.keys()], [CACHE_VERSION]);
  env.online = false;
  const { sw } = await update(env); // same bytes: the active worker
  assert.equal((await sw.fetch(SCOPE, { mode: 'navigate' })).body, 'shell v2');
});

test('a new version leaves other marsh.city apps\' caches alone', async () => {
  // CacheStorage is per origin, not per worker scope: every app on
  // marsh.city shares one namespace.
  const env = makeEnv();
  for (const name of ['dailydungeon-shell-3f9a', 'buttongriddle-v17']) {
    (await env.caches.open(name)).put(ORIGIN + '/' + name, response('theirs'));
  }
  await update(env, withVersion('7.5.5'));
  await update(env);
  assert.deepEqual([...env.store.keys()].sort(), ['buttongriddle-v17', 'dailydungeon-shell-3f9a', CACHE_VERSION]);
});

test('install fetches the shell past the browser\'s HTTP cache', async () => {
  // GitHub Pages sends max-age=600, so a default-mode fetch shortly after a
  // deploy could store the previous HTML under the new cache name.
  const env = makeEnv();
  await update(env);
  const precache = env.fetches.filter((f) => f.url.startsWith(SCOPE));
  assert.ok(precache.length >= 6);
  assert.deepEqual([...new Set(precache.map((f) => f.cache))], ['reload']);
});

test('an update that cannot fetch the HTML keeps the previous version working offline — unhappy path', async () => {
  const env = makeEnv();
  await update(env, withVersion('7.5.5'));
  env.dropHtml = true; // sw.js arrives, the big HTML file times out
  const { outcome } = await update(env);
  assert.equal(outcome, 'install-failed');
  assert.ok(env.store.has('rgxl-shell-7.5.5'), 'previous cache kept');
  env.online = false;
  const old = bootWorker(env, withVersion('7.5.5')); // still in charge
  assert.equal((await old.fetch(SCOPE, { mode: 'navigate' })).body, 'shell v1');
});

// ── Page side: registration ─────────────────────────────────────────────

/** A fake navigator.serviceWorker. `controlled` says whether a worker already
    controls the page at load (false on the very first visit). */
function installServiceWorker(w, { controlled = true } = {}) {
  const container = new w.EventTarget();
  const reg = { updates: 0, update() { this.updates++; return Promise.resolve(); } };
  container.controller = controlled ? {} : null;
  container.registered = [];
  container.register = (url) => { container.registered.push(url); return Promise.resolve(reg); };
  Object.defineProperty(w.navigator, 'serviceWorker', { value: container, configurable: true });
  return { container, reg };
}

async function afterLoad(w) {
  if (w.document.readyState !== 'complete') await new Promise((r) => w.addEventListener('load', r, { once: true }));
  await Promise.resolve();
}

test('an http(s) page registers sw.js, relative to itself', async () => {
  let sw;
  const w = loadApp({ url: 'https://marsh.city/radio/', beforeParse: (win) => { sw = installServiceWorker(win); } });
  await afterLoad(w);
  assert.deepEqual(sw.container.registered, ['sw.js']);
  w.close(); // real timers here: the 6-hour update check would hold the process open
});

test('file:// (the APK) never registers a service worker — unhappy path', async () => {
  let sw;
  const w = loadApp({ url: 'file:///android_asset/RadioGridXL.html', beforeParse: (win) => { sw = installServiceWorker(win); } });
  await afterLoad(w);
  assert.deepEqual(sw.container.registered, []);
});

// ── Page side: picking up a new version ─────────────────────────────────
// A new worker takes over (controllerchange); the open page is still the old
// version until it reloads. jsdom can't navigate, so a reload shows up as its
// "not implemented: navigation" error.

const UPDATE_RETRY_MS = 5 * 60 * 1000;
const UPDATE_CHECK_MS = 6 * 60 * 60 * 1000;

async function bootWithWorker({ controlled = true, cfg } = {}) {
  let sw;
  const t = bootPlayback({ cfg, beforeParse: (win) => { sw = installServiceWorker(win, { controlled }); } });
  await afterLoad(t.w);
  return {
    ...t, sw,
    newVersion: () => sw.container.dispatchEvent(new t.w.Event('controllerchange')),
    reloads: () => t.w.__bootErrors.filter((e) => /navigation/i.test(e.message)).length,
    setVisible(visible) {
      Object.defineProperty(t.w.document, 'visibilityState', { configurable: true, get: () => (visible ? 'visible' : 'hidden') });
      t.w.document.dispatchEvent(new t.w.Event('visibilitychange'));
    },
  };
}

test('a new version loads at once when nothing is playing', async () => {
  const t = await bootWithWorker();
  t.newVersion();
  assert.equal(t.reloads(), 1);
  assert.equal(t.w.sessionStorage.getItem('rgxl_update_reload'), '1', 'marked as an update reload');
});

test('the very first install does not reload the page', async () => {
  const t = await bootWithWorker({ controlled: false });
  t.newVersion(); // clients.claim() on first install
  assert.equal(t.reloads(), 0);
  t.newVersion(); // a real update later in the same session
  assert.equal(t.reloads(), 1);
});

test('a new version never interrupts a playing station; it loads once stopped', async () => {
  const t = await bootWithWorker();
  t.w.playStream('s1');
  await t.clock.tick(CONNECT_MS);
  t.newVersion();
  await t.clock.tick(3 * UPDATE_RETRY_MS);
  assert.equal(t.reloads(), 0, 'still playing');
  assert.equal(t.audio.state.paused, false);
  t.w.userStop();
  await t.clock.tick(UPDATE_RETRY_MS);
  assert.equal(t.reloads(), 1);
});

/** Advance `ms` with a tap every 50 s, as someone working in settings
    would: the idle timeout closes settings and the PIN pad left alone. */
async function busyFor(t, ms, target) {
  for (let left = ms; left > 0; left -= 50 * 1000) {
    (target || t.w.document.body).dispatchEvent(new t.w.Event('pointerdown', { bubbles: true }));
    await t.clock.tick(Math.min(left, 50 * 1000));
  }
}

test('a new version waits while settings are in use, so unsaved edits survive', async () => {
  const t = await bootWithWorker();
  t.w.openSettings();
  t.newVersion();
  await busyFor(t, 2 * UPDATE_RETRY_MS);
  assert.equal(t.reloads(), 0);
  t.w.closeSettings();
  await t.clock.tick(UPDATE_RETRY_MS);
  assert.equal(t.reloads(), 1);
});

test('settings left alone time out, and then the waiting version loads', async () => {
  const t = await bootWithWorker();
  t.w.openSettings();
  t.newVersion();
  await t.clock.tick(4 * 60 * 1000); // past the 3 minutes and the 30-second prompt
  assert.equal(t.reloads(), 0);
  assert.equal(t.w.document.getElementById('settings-panel').classList.contains('open'), false);
  await t.clock.tick(UPDATE_RETRY_MS);
  assert.equal(t.reloads(), 1);
});

// settingsOpen only turns true once the PIN is accepted, so the PIN pad
// needs holding on its own: a reload mid-entry would wipe the digits.
test('a new version waits while the PIN pad is open, so a half-typed PIN survives', async () => {
  const t = await bootWithWorker();
  const d = t.w.document;
  t.w.localStorage.setItem('rgxl_pin', '1234');
  d.getElementById('settings-btn').click();
  assert.equal(d.getElementById('pin-overlay').classList.contains('visible'), true, 'PIN pad open');
  d.querySelector('#pin-pad [aria-label="1"]').click();
  d.querySelector('#pin-pad [aria-label="2"]').click();
  t.newVersion();
  await busyFor(t, 2 * UPDATE_RETRY_MS, d.getElementById('pin-pad'));
  assert.equal(t.reloads(), 0);
  assert.equal(d.querySelectorAll('#pin-dots .filled').length, 2, 'the digits are still there');
  d.querySelector('#pin-pad [aria-label="Cancel"]').click();
  await t.clock.tick(UPDATE_RETRY_MS);
  assert.equal(t.reloads(), 1);
});

// Paused counts as quiet, but a pause from the lock screen leaves the
// no-network dialog up (only Wi-Fi returning clears it). Waiting must not
// cost the paused radio its silence either.
test('a new version waits while the no-network dialog is up, and the paused radio stays paused — unhappy path', async () => {
  const t = await bootWithWorker();
  t.w.playStream('s1');
  await t.clock.tick(CONNECT_MS);
  t.setOnline(false);
  await t.clock.tick(0);
  t.w.softStop(); // what the MediaSession 'pause' action runs
  await t.clock.tick(0);
  assert.equal(t.overlayShown(), true);
  t.newVersion();
  await t.clock.tick(2 * UPDATE_RETRY_MS);
  assert.equal(t.reloads(), 0, 'the dialog is still up');
  const fetches = t.audio.fetches.length;
  t.setOnline(true); // clears the dialog; the radio stays paused
  await t.clock.tick(UPDATE_RETRY_MS);
  assert.equal(t.overlayShown(), false);
  assert.equal(t.reloads(), 1);
  assert.equal(t.audio.state.paused, true, 'paused audio never came back');
  assert.equal(t.audio.fetches.length, fetches, 'nothing reloaded the stream');
});

// The update finds dialogs by markup, not by a list, so this walks every
// dialog in the page and shows each the way the app does ('visible' on an
// .overlay, 'open' on the rest). A dialog added later without aria-modal
// fails here. Classes are set directly because some (help, station search,
// the emoji picker) only open from inside settings, which already holds it.
test('a new version waits while any dialog in the page is showing', async () => {
  const t = await bootWithWorker();
  const dialogs = [...t.w.document.querySelectorAll('[role="dialog"], [role="alertdialog"]')];
  assert.ok(dialogs.length >= 9, 'found the dialogs');
  for (const [i, el] of dialogs.entries()) {
    const shown = el.classList.contains('overlay') ? 'visible' : 'open';
    el.classList.add(shown);
    t.newVersion();
    await t.clock.tick(UPDATE_RETRY_MS);
    assert.equal(t.reloads(), i, `#${el.id} is showing`);
    el.classList.remove(shown);
    await t.clock.tick(UPDATE_RETRY_MS);
    assert.equal(t.reloads(), i + 1, `#${el.id} closed`);
  }
});

test('without a way to mark the reload, the new version waits for the next launch — unhappy path', async () => {
  const t = await bootWithWorker();
  Object.defineProperty(t.w, 'sessionStorage', { configurable: true, get() { throw new t.w.DOMException('blocked', 'SecurityError'); } });
  t.newVersion();
  await t.clock.tick(2 * UPDATE_RETRY_MS);
  assert.equal(t.reloads(), 0);
});

test('the app checks for a new version on coming back on screen and every 6 hours', async () => {
  const t = await bootWithWorker();
  assert.equal(t.sw.reg.updates, 0);
  t.setVisible(false);
  t.setVisible(true);
  assert.equal(t.sw.reg.updates, 1);
  await t.clock.tick(UPDATE_CHECK_MS);
  assert.equal(t.sw.reg.updates, 2);
});

/** Launch with Resume on and a last-played station; `updateReload` boots as
    the page an update reload would load. */
function launch({ updateReload }) {
  return loadApp({
    beforeParse(win) {
      win.localStorage.setItem('rgxl_cfg', JSON.stringify({ streams: STREAMS, resume: 'on' }));
      win.localStorage.setItem('rgxl_last', 's1');
      if (updateReload) win.sessionStorage.setItem('rgxl_update_reload', '1');
    },
  });
}

test('an update reload never resumes a stopped radio, even with Resume on', () => {
  const resumed = launch({ updateReload: false });
  assert.equal(resumed.document.getElementById('btn-s1').getAttribute('aria-current'), 'true', 'control: a real launch resumes');
  const reloaded = launch({ updateReload: true });
  assert.equal(reloaded.document.getElementById('btn-s1').getAttribute('aria-current'), null);
  assert.equal(reloaded.sessionStorage.getItem('rgxl_update_reload'), null, 'flag used up: the next launch is a real launch again');
});

// ── Page side: asking to keep storage ───────────────────────────────────

/** navigator.storage that counts persist() requests. */
function installStorage(w, { persisted = false } = {}) {
  const storage = { asked: 0, persisted: () => Promise.resolve(persisted), persist() { this.asked++; return Promise.resolve(true); } };
  Object.defineProperty(w.navigator, 'storage', { value: storage, configurable: true });
  return storage;
}

async function bootForStorage({ installed, persisted }) {
  let storage;
  const w = loadApp({
    url: 'https://marsh.city/radio/',
    beforeParse(win) {
      installServiceWorker(win);
      storage = installStorage(win, { persisted });
      const base = win.matchMedia;
      win.matchMedia = (q) => (/display-mode:\s*standalone/.test(q) ? { ...base(q), matches: installed } : base(q));
    },
  });
  await afterLoad(w);
  await new Promise((r) => setImmediate(r));
  w.close();
  return storage;
}

test('a browser tab never asks to keep storage (Firefox would show a permission prompt)', async () => {
  assert.equal((await bootForStorage({ installed: false, persisted: false })).asked, 0);
});

test('the installed app asks to keep storage, once it is not already kept', async () => {
  assert.equal((await bootForStorage({ installed: true, persisted: false })).asked, 1);
  assert.equal((await bootForStorage({ installed: true, persisted: true })).asked, 0);
});

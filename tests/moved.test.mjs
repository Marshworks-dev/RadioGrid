/**
 * The last build at marsh.city/radio (src/app/24-moved.js): it says where the
 * radio went instead of showing stations, never plays, and keeps settings and
 * Export Backup reachable so a radio can be carried to radio.marshworks.dev.
 * Every other build (the new address, file:// for the APK, a branded
 * profile) never shows any of it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadApp } from './harness.mjs';
import { markMoved, isMarkedMoved, MOVED_TO, hostedFiles } from '../hosted-build.mjs';

const OLD = 'https://marsh.city/radio/';
const NEW = 'https://radio.marshworks.dev/';
const MOVED_TEXT = 'This radio has moved to radio.marshworks.dev. Please ask the person who set it up to change it.';
const SAVED = {
  rgxl_cfg: JSON.stringify({ v: 1, orgName: 'Kitchen radio', resume: 'on', streams: [{ id: 'k1', label: 'KUMD', sub: 'Duluth', url: 'https://example.test/kumd.mp3', emoji: '📻', color: 'blue' }] }),
  rgxl_pin: '2468',
  rgxl_last: 'k1',
};

/** The moved build at the old address, booted with a radio already saved
    there, the way a phone meets it after the silent update. */
function oldRadio() {
  return loadApp({ url: OLD, moved: true, beforeParse: (w) => { for (const [k, v] of Object.entries(SAVED)) w.localStorage.setItem(k, v); } });
}

// ── The moved screen ──────────────────────────────────────────────────────
test('the moved build shows where the radio went, in place of the stations and Stop', () => {
  const w = oldRadio();
  const d = w.document;
  assert.deepEqual(w.__bootErrors, []);
  assert.equal(d.getElementById('moved-screen').textContent, MOVED_TEXT);
  assert.equal(d.querySelectorAll('.stream-btn').length, 0, 'no station buttons');
  assert.ok(d.documentElement.classList.contains('is-moved'), 'the class that hides Stop and the transport');
  assert.equal(d.getElementById('buttons').getAttribute('aria-label'), 'This radio has moved');
});

test('the moved screen is plain text: no link, no live region, and it takes no focus', () => {
  const w = oldRadio();
  const d = w.document;
  const main = d.getElementById('buttons');
  assert.equal(main.querySelectorAll('a, [href], button, [onclick], [tabindex]').length, 0);
  for (const el of [main, ...main.querySelectorAll('*')]) {
    assert.equal(el.getAttribute('aria-live'), null, 'not a live region');
    assert.ok(!['alert', 'status', 'log', 'dialog'].includes(el.getAttribute('role')), `role ${el.getAttribute('role')}`);
  }
  assert.ok(d.activeElement === d.body || d.activeElement === null, 'focus never moves to it');
});

test('a redraw (resize, Apply) keeps the moved screen', () => {
  const w = oldRadio();
  w.renderButtons();
  assert.equal(w.document.getElementById('moved-screen').textContent, MOVED_TEXT);
  assert.equal(w.document.querySelectorAll('.stream-btn').length, 0);
});

// ── Never plays ───────────────────────────────────────────────────────────
test('the moved build never plays: not on launch with Resume on, not when asked to', () => {
  const w = oldRadio();
  const audio = w.document.getElementById('audio-player');
  assert.equal(audio.getAttribute('src'), null, 'Resume did not start the saved station');
  w.playStream('k1');
  assert.equal(audio.getAttribute('src'), null, 'playStream did nothing');
});

test('station browser previews never play at the old address either — unhappy path', () => {
  let made = 0;
  const w = loadApp({
    url: OLD, moved: true,
    beforeParse: (win) => {
      for (const [k, v] of Object.entries(SAVED)) win.localStorage.setItem(k, v);
      win.Audio = function () { made++; return { play: () => Promise.resolve(), addEventListener() {}, pause() {} }; };
    },
  });
  const btn = w.document.createElement('button');
  btn.setAttribute('aria-label', 'Preview KUMD');
  w.toggleSbPreview('https://example.test/kumd.mp3', btn);
  assert.equal(made, 0, 'no preview audio was made');
  // The same call on the new address does play, so the guard is what stops it.
  const live = loadApp({ url: NEW, beforeParse: (win) => { win.Audio = function () { made++; return { play: () => Promise.resolve(), addEventListener() {}, pause() {} }; }; } });
  const btn2 = live.document.createElement('button');
  btn2.setAttribute('aria-label', 'Preview KUMD');
  live.toggleSbPreview('https://example.test/kumd.mp3', btn2);
  assert.equal(made, 1);
});

// ── Saved settings survive, and move ──────────────────────────────────────
test('every saved key is exactly as it was after the moved build boots', () => {
  const w = oldRadio();
  for (const [k, v] of Object.entries(SAVED)) assert.equal(w.localStorage.getItem(k), v, k);
});

test('settings opens behind the PIN, with the moved card first: the address as text, the steps, and Export Backup', () => {
  const w = oldRadio();
  const d = w.document;
  w.requestSettings();
  assert.ok(d.getElementById('pin-overlay').classList.contains('visible'), 'the saved PIN still guards settings');
  w.openSettings();
  const card = d.getElementById('moved-card');
  assert.equal(card.hidden, false);
  assert.equal(d.getElementById('settings-body').querySelector('.s-group:not([hidden])'), card, 'first visible group in settings');
  assert.equal(d.getElementById('moved-card-address').textContent, MOVED_TO);
  const steps = [...card.querySelectorAll('.moved-steps li')].map((li) => li.textContent);
  assert.equal(steps.length, 5);
  assert.match(steps[0], /Export Backup/);
  assert.match(steps[1], /open radio\.marshworks\.dev/);
  assert.match(steps[2], /Import Backup/);
  const exportBtn = card.querySelector('button');
  assert.equal(exportBtn.getAttribute('onclick'), 'exportConfig()');
  assert.equal(card.querySelectorAll('a, [href], [target]').length, 0, 'the address is text, never a link');
});

test('a backup exported at the old address restores at the new one: stations, settings and the PIN', () => {
  const old = oldRadio();
  const backup = JSON.stringify(old.buildBackupPayload(true));
  const fresh = loadApp({ url: NEW });
  fresh.importBackupText(backup);
  const cfg = JSON.parse(fresh.localStorage.getItem('rgxl_cfg'));
  assert.equal(cfg.orgName, 'Kitchen radio');
  assert.deepEqual(cfg.streams.map((s) => s.url), ['https://example.test/kumd.mp3']);
  assert.equal(fresh.localStorage.getItem('rgxl_pin'), '2468');
  assert.equal(fresh.document.getElementById('moved-screen'), null, 'the imported radio is a radio');
  assert.equal(fresh.document.getElementById('moved-card').hidden, true);
});

// ── Only the old address's build ──────────────────────────────────────────
test('no other build shows any of it: the new address, the APK, a branded profile — unhappy path', () => {
  for (const w of [loadApp({ url: NEW }), loadApp({ url: 'file:///android_asset/RadioGridXL.html', moved: true }), loadApp({ url: NEW, profile: 'example-org' })]) {
    const d = w.document;
    assert.equal(d.getElementById('moved-screen'), null);
    assert.equal(d.getElementById('moved-card').hidden, true);
    assert.ok(d.querySelectorAll('.stream-btn').length > 0, 'stations show');
    assert.ok(!d.documentElement.classList.contains('is-moved'));
  }
});

test('a mark that isn\'t a plain host name is ignored, never written into the page — unhappy path', () => {
  for (const content of ['', 'javascript:alert(1)', 'radio.marshworks.dev/<img src=x>', 'localhost']) {
    const w = loadApp({ url: OLD, moved: content });
    assert.equal(w.document.getElementById('moved-screen'), null, JSON.stringify(content));
    assert.ok(w.document.querySelectorAll('.stream-btn').length > 0, 'still a radio');
  }
});

// ── The mark itself ───────────────────────────────────────────────────────
test('markMoved puts the mark right after the charset, once, and refuses a second — unhappy path', () => {
  const html = '<!doctype html><head><meta charset="UTF-8"><title>x</title>';
  const marked = markMoved(html);
  assert.match(marked, /<meta charset="UTF-8">\n<meta name="radiogrid-moved" content="radio\.marshworks\.dev">/);
  assert.throws(() => markMoved(marked), /already marked moved/);
  assert.throws(() => markMoved('<html>'), /charset/);
});

test('hostedFiles marks only when asked, and the mark changes the cache name so installed radios update', async () => {
  const { mkdtempSync, mkdirSync, cpSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join, dirname } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
  const dir = mkdtempSync(join(tmpdir(), 'rg-moved-'));
  try {
    for (const f of ['manifest.json', 'icon.svg', 'icon-192.png', 'icon-512.png', 'sw.js', 'feedback', 'licenses', 'twa/assetlinks.json']) cpSync(join(repo, f), join(dir, f), { recursive: true });
    mkdirSync(join(dir, 'dist'));
    cpSync(join(repo, 'RadioGridXL.html'), join(dir, 'dist', 'RadioGridXL.html'));
    const plain = await hostedFiles(dir);
    const moved = await hostedFiles(dir, { moved: true });
    const get = (files, name) => String(files.find((f) => f.name === name).data);
    assert.equal(isMarkedMoved(get(plain, 'index.html')), false);
    assert.equal(isMarkedMoved(get(moved, 'index.html')), true);
    assert.ok(get(moved, 'index.html').includes('<meta name="radiogrid-moved" content="radio.marshworks.dev">'));
    assert.notEqual(get(plain, 'sw.js'), get(moved, 'sw.js'), 'a new cache name, so the update reaches installed radios');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

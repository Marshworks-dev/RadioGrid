/**
 * Guide tests — keep guide/guide.md honest as the app changes.
 *
 * Every scene in guide/scenes.mjs is replayed against the real app (jsdom):
 * if a control the guide tells people to tap is renamed, removed or no longer
 * visible at that point, the scene fails by name. The rest checks that the
 * guide, its scenes and its screenshots line up, and that the screenshots were
 * retaken for the current app version. Also covers the in-app guide button.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadApp } from './harness.mjs';
import { installClock, installFakeAudio } from './playback-fakes.mjs';
import { SCENES, PAGE_SHOTS } from '../guide/scenes.mjs';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
const guideMd = readFileSync(join(repo, 'guide', 'guide.md'), 'utf-8');
const pkg = JSON.parse(readFileSync(join(repo, 'package.json'), 'utf-8'));

const nextFrame = (w) => new Promise((r) => w.requestAnimationFrame(() => r()));

/** Shown = in the DOM, not visibility:hidden (inherited), and neither it nor any
 *  ancestor is hidden or display:none. */
function isShown(w, el) {
  if (w.getComputedStyle(el).visibility === 'hidden') return false;
  for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
    if (n.hidden || w.getComputedStyle(n).display === 'none') return false;
  }
  return true;
}

function findShown(w, scene, selector) {
  const el = w.document.querySelector(selector);
  assert.ok(el, `[${scene.id}] "${selector}" is missing from the app`);
  assert.ok(isShown(w, el), `[${scene.id}] "${selector}" exists but isn't visible at this step`);
  return el;
}

/** Replay a scene's steps in jsdom. `playable` gives the app a spec-shaped
    media element on a manual clock, so a tapped station really starts (the
    capture plays silence for the same step), and lets time pass after each step. */
async function replay(scene, { playable = false } = {}) {
  const seed = scene.seed || {};
  const w = loadApp({ profile: 'default', seed });
  // The harness reloads a seeded config but doesn't redraw from it; boot does.
  if (seed.rgxl_cfg) { w.updateMode(); w.applyTheme(); }
  let clock = null;
  if (playable) {
    clock = installClock(w);
    installFakeAudio(w, w.document.getElementById('audio-player'));
  }
  for (const step of scene.steps) {
    if (step.tapLogo) {
      for (let i = 0; i < step.tapLogo; i++) findShown(w, scene, '#logo-area').click();
    } else if (step.pin) {
      for (const digit of step.pin) findShown(w, scene, `#pin-pad [aria-label="${digit}"]`).click();
    } else if (step.click) {
      findShown(w, scene, step.click).click();
    } else if (step.fill) {
      const el = findShown(w, scene, step.fill);
      el.value = step.value;
      el.dispatchEvent(new w.Event('input', { bubbles: true }));
    } else {
      assert.fail(`[${scene.id}] unknown step ${JSON.stringify(step)}`);
    }
    await nextFrame(w); // settings open on the next frame
    if (clock) await clock.tick(1000); // a station connects and starts playing
  }
  findShown(w, scene, scene.highlight || scene.shows);
  return w;
}

for (const scene of SCENES) {
  test(`guide scene "${scene.id}" (${scene.title}) still works in the app`, async () => {
    const w = await replay(scene);
    assert.deepEqual(w.__bootErrors.map((e) => e.message), [], 'no errors during boot');
  });
}
for (const shot of PAGE_SHOTS) {
  test(`project-page shot "${shot.id}" still works in the app`, async () => {
    const w = await replay(shot, { playable: true });
    assert.deepEqual(w.__bootErrors.map((e) => e.message), [], 'no errors during boot');
  });
}

test('every project-page shot has an id, alt text and a captured image', () => {
  const ids = PAGE_SHOTS.map((s) => s.id);
  assert.equal(new Set(ids).size, ids.length, 'page shot ids are unique');
  for (const shot of PAGE_SHOTS) {
    assert.ok(shot.alt && shot.alt.length > 20, `${shot.id}: alt text says what the picture shows`);
    assert.ok(existsSync(join(repo, 'guide', 'page', `${shot.id}.webp`)), `page/${shot.id}.webp is missing — run npm run guide:capture`);
  }
});

test('guide, scenes and screenshots line up', () => {
  const referenced = [...guideMd.matchAll(/!\[[^\]]*\]\(shots\/([a-z0-9-]+)\.webp\)/g)].map((m) => m[1]);
  const sceneIds = SCENES.map((s) => s.id);
  assert.equal(new Set(sceneIds).size, sceneIds.length, 'scene ids are unique');
  for (const id of referenced) {
    assert.ok(sceneIds.includes(id), `guide.md shows shots/${id}.webp but no scene captures it`);
    assert.ok(existsSync(join(repo, 'guide', 'shots', `${id}.webp`)), `shots/${id}.webp is missing — run npm run guide:capture`);
  }
  for (const id of sceneIds) {
    assert.ok(referenced.includes(id), `scene "${id}" isn't used in guide.md`);
  }
});

test('guide screenshots were captured at the current app version (unhappy path: stale)', () => {
  const stamped = guideMd.match(/^appVersion:\s*(\S+)$/m)?.[1];
  assert.ok(stamped, 'guide.md frontmatter has appVersion');
  assert.equal(stamped, pkg.version,
    `guide screenshots are from v${stamped} but the app is v${pkg.version} — run npm run guide:capture and review the guide`);
});

// ── In-app guide button + overlay ─────────────────────────────────────────
test('hosted default build shows the guide button; tapping it opens a sandboxed frame', async () => {
  const w = loadApp({ profile: 'default' });
  const d = w.document;
  assert.equal(d.getElementById('help-section').hidden, false);
  assert.equal(d.querySelector('#help-body iframe'), null, 'no frame (and no request) until tapped');

  d.getElementById('settings-btn').click();
  await nextFrame(w);
  d.getElementById('help-btn').click();

  const overlay = d.getElementById('help-overlay');
  const frame = d.querySelector('#help-body iframe');
  assert.ok(overlay.classList.contains('open'));
  assert.equal(frame.getAttribute('sandbox'), '', 'empty sandbox: no scripts, no same-origin');
  assert.equal(frame.getAttribute('src'), 'https://marsh.city/embed/guides/radiogridxl/');
  assert.equal(d.activeElement.id, 'help-close', 'focus moves to the close button');

  d.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal(overlay.classList.contains('open'), false, 'Escape closes the guide');
  assert.ok(d.getElementById('settings-panel').classList.contains('open'), 'settings stay open underneath');
  assert.equal(d.activeElement.id, 'help-btn', 'focus returns to the guide button');
  assert.equal(d.querySelector('#help-body iframe'), null, 'frame dropped so the next open starts at the guide again');
});

test('offline: the guide overlay says it needs a connection instead of loading a frame', async () => {
  const w = loadApp({ profile: 'default' });
  Object.defineProperty(w.navigator, 'onLine', { value: false, configurable: true });
  w.openHelp();
  assert.equal(w.document.querySelector('#help-body iframe'), null);
  assert.match(w.document.querySelector('#help-body .help-offline').textContent, /internet connection/);
  w.closeHelp();
  assert.equal(w.document.querySelector('#help-body .help-offline'), null, 'next open retries');
});

test('no guide button on file:// (Android APK / copied file) — unhappy path', () => {
  const w = loadApp({ profile: 'default', url: 'file:///android_asset/RadioGridXL.html' });
  assert.equal(w.document.getElementById('help-section').hidden, true);
  w.openHelp();
  assert.equal(w.document.getElementById('help-overlay').classList.contains('open'), false, 'openHelp is a no-op');
});

test('no guide button when the profile names no guide (a branded build)', () => {
  const w = loadApp({ profile: 'example-org' });
  assert.equal(w.document.getElementById('help-section').hidden, true);
});

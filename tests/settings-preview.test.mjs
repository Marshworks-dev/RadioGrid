/**
 * Settings preview: the Preview button slides settings aside to show the grid
 * with unapplied changes, saves and reverts nothing, and leaves the grid
 * readable but unusable until "Back to settings". Run with: npm run test:dom
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadApp } from './harness.mjs';
import { bootPlayback, STREAMS, CONNECT_MS } from './playback-fakes.mjs';

const nextFrame = (w) => new Promise((r) => w.requestAnimationFrame(() => r()));
const visibility = (w, id) => w.getComputedStyle(w.document.getElementById(id)).visibility;

async function openAndPreview(w) {
  w.openSettings();
  await nextFrame(w);
  w.document.getElementById('settings-preview').click();
  await nextFrame(w);
}

test('Preview shows the grid with unapplied changes, and Back returns to the same settings', async () => {
  const w = loadApp();
  const d = w.document;
  w.openSettings();
  await nextFrame(w);
  d.querySelector('.theme-modes [data-mode="light"]').click();
  d.querySelector('.chip[data-group="size"][data-val="ultra"]').click();
  d.getElementById('in-org-name').value = 'Rec Room';
  w.previewOrgName();
  const label = d.querySelector('#stream-editor input[data-field="label"]');
  label.value = 'Morning Jazz';
  label.dispatchEvent(new w.Event('input'));

  d.getElementById('settings-preview').click();
  await nextFrame(w);
  assert.equal(visibility(w, 'settings-panel'), 'hidden', 'the panel is out of the way');
  assert.equal(d.getElementById('preview-back').hidden, false);
  assert.equal(d.activeElement.id, 'preview-back', 'focus moves to Back to settings');
  assert.equal(d.documentElement.getAttribute('data-size'), 'ultra');
  assert.equal(d.getElementById('org-name').textContent, 'Rec Room');
  assert.match(d.querySelector('#buttons .stream-btn, #buttons button').textContent, /Morning Jazz/);
  assert.equal(w.localStorage.getItem('rgxl_cfg'), null, 'nothing saved');

  d.getElementById('preview-back').click();
  await nextFrame(w);
  assert.equal(visibility(w, 'settings-panel'), 'visible');
  assert.equal(d.getElementById('preview-back').hidden, true);
  assert.equal(d.activeElement.id, 'settings-preview', 'focus goes back to Preview');
  assert.equal(d.getElementById('in-org-name').value, 'Rec Room', 'fields kept');
  assert.equal(d.querySelector('#stream-editor input[data-field="label"]').value, 'Morning Jazz');
});

test('previewing saves and reverts nothing: Close still asks, Apply still saves', async () => {
  const w = loadApp();
  const d = w.document;
  w.openSettings();
  await nextFrame(w);
  d.querySelector('.chip[data-group="size"][data-val="ultra"]').click();
  d.getElementById('settings-preview').click();
  await nextFrame(w);
  w.endPreview();
  await nextFrame(w);
  w.closeSettings();
  assert.ok(d.getElementById('discard-overlay').classList.contains('visible'), 'unsaved changes still noticed');
  w.cancelDiscard();

  d.getElementById('settings-preview').click();
  await nextFrame(w);
  w.endPreview();
  w.applySettings();
  assert.equal(JSON.parse(w.localStorage.getItem('rgxl_cfg')).size, 'ultra', 'Apply saves');
});

test('Escape in preview returns to settings instead of closing it', async () => {
  const w = loadApp();
  const d = w.document;
  await openAndPreview(w);
  d.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await nextFrame(w);
  assert.equal(d.getElementById('preview-back').hidden, true);
  assert.equal(visibility(w, 'settings-panel'), 'visible');
  assert.ok(d.getElementById('settings-panel').classList.contains('open'), 'settings still open');
  assert.equal(d.getElementById('discard-overlay').classList.contains('visible'), false);
});

test('closing settings from a preview clears it', async () => {
  const w = loadApp();
  const d = w.document;
  await openAndPreview(w);
  w.doCloseSettings();
  assert.equal(d.getElementById('preview-back').hidden, true);
  assert.equal(d.getElementById('settings-panel').classList.contains('previewing'), false);
  w.startPreview();
  assert.equal(d.getElementById('preview-back').hidden, true, 'no preview without settings open');
});

test('unhappy path: in preview, nothing on the grid starts, pauses or stops audio', async () => {
  const t = bootPlayback();
  const d = t.w.document;
  t.w.playStream('s1');
  await t.clock.tick(CONNECT_MS);
  t.w.openSettings();
  await t.clock.tick(0);
  t.w.startPreview();

  t.button('s1').click();
  t.button('s2').click();
  d.getElementById('simple-stop').click();
  for (const b of d.querySelectorAll('#adv-transport button')) b.click();
  t.button('s2').dispatchEvent(new t.w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  await t.clock.tick(CONNECT_MS);
  assert.equal(t.audio.state.paused, false, 'still playing');
  assert.equal(t.audio.state.src, STREAMS[0].url, 'same station');
  assert.equal(t.label('s1'), STREAMS[0].label + ' (on)');
  assert.equal(d.getElementById('sleep-overlay').classList.contains('visible'), false, 'no sleep timer dialog');

  t.w.endPreview();
  t.w.doCloseSettings();
  t.button('s1').click();
  await t.clock.tick(0);
  assert.equal(t.audio.state.paused, true, 'the grid works again once settings is closed');
});

test('unhappy path: five logo taps in preview do not open the PIN pad', async () => {
  // Saved with the Settings button hidden, so the logo taps are live.
  const w = loadApp({ profile: 'example-org', seed: { rgxl_cfg: JSON.stringify({ settingsButton: 'off' }) } });
  const d = w.document;
  await openAndPreview(w);
  for (let i = 0; i < 5; i++) d.getElementById('logo-area').click();
  for (let i = 0; i < 5; i++) d.getElementById('logo-area').dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  assert.equal(d.getElementById('pin-overlay').classList.contains('visible'), false);
});

test('screen readers can read the grid in preview: it is not hidden or inert', async () => {
  const w = loadApp();
  const d = w.document;
  await openAndPreview(w);
  const btn = d.querySelector('#buttons button');
  assert.equal(btn.closest('[aria-hidden="true"], [inert]'), null);
  assert.equal(w.getComputedStyle(btn).visibility, 'visible');
  assert.ok(btn.getAttribute('aria-label'), 'each station still has its name');
});

// ── Preview hint ──────────────────────────────────────────────────────────
const nextPaint = (w) => new Promise((r) => w.requestAnimationFrame(() => r()));
const HINT = 'Preview only. Tap Back to settings to make changes.';

test('a tap preview swallows says why and nudges Back to settings, then clears after 3 s', async () => {
  const t = bootPlayback();
  const d = t.w.document;
  t.w.openSettings();
  await t.clock.tick(0);
  t.w.startPreview();
  await nextPaint(t.w);
  const hint = d.getElementById('preview-hint');
  const back = d.getElementById('preview-back');
  assert.equal(hint.textContent, '', 'nothing shows until a tap does nothing');

  t.button('s1').click();
  await nextPaint(t.w);
  assert.equal(hint.textContent, HINT);
  assert.equal(hint.getAttribute('role'), 'status', 'screen readers hear it');
  assert.ok(hint.classList.contains('visible'));
  assert.ok(back.classList.contains('nudge'));
  assert.equal(d.activeElement.id, 'preview-back', 'focus stays where it was');
  assert.ok(!t.audio.state.src, 'the tap still did nothing');

  await t.clock.tick(2000);
  d.getElementById('simple-stop').click(); // a second tap restarts the 3 s
  await nextPaint(t.w);
  assert.equal(d.querySelectorAll('#preview-hint').length, 1, 'one message, not two');
  await t.clock.tick(2000);
  assert.ok(hint.classList.contains('visible'), 'still showing 2 s after the second tap');
  await t.clock.tick(1000);
  assert.equal(hint.classList.contains('visible'), false);
  assert.equal(hint.textContent, '');
  assert.equal(back.classList.contains('nudge'), false);
});

test('the logo in preview shows the hint too', async () => {
  const w = loadApp();
  await openAndPreview(w);
  w.document.getElementById('logo-area').click();
  await nextPaint(w);
  assert.equal(w.document.getElementById('preview-hint').textContent, HINT);
});

test('unhappy path: leaving preview with the hint showing clears it, and no hint outside preview', async () => {
  const t = bootPlayback();
  const d = t.w.document;
  const hint = d.getElementById('preview-hint');
  t.w.openSettings();
  await t.clock.tick(0);
  t.w.startPreview();
  t.button('s1').click();
  await nextPaint(t.w);
  d.getElementById('preview-back').click();
  assert.equal(hint.classList.contains('visible'), false, 'Back clears it');
  assert.equal(d.getElementById('preview-back').classList.contains('nudge'), false);

  t.w.startPreview();
  t.button('s1').click();
  t.w.doCloseSettings(); // closing before the next frame: the queued show must not land
  await nextPaint(t.w);
  assert.equal(hint.classList.contains('visible'), false, 'closing settings clears it');

  t.button('s1').click(); // settings closed: a normal tap
  await nextPaint(t.w);
  await t.clock.tick(0);
  assert.equal(hint.textContent, '', 'no hint outside preview');
  assert.equal(t.audio.state.paused, false, 'the tap played the station');
});

/**
 * Settings and the PIN pad close themselves when left alone (IDLE TIMEOUT in
 * RadioGridXL.html), so a listener is never left facing them. On the fake
 * clock and media element from playback-fakes.mjs.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bootPlayback, CONNECT_MS } from './playback-fakes.mjs';

const MIN = 60 * 1000;
const frame = (w) => new Promise((r) => w.requestAnimationFrame(() => r()));

function boot(opts) {
  const t = bootPlayback(opts);
  const d = t.w.document;
  t.settingsOpen = () => d.getElementById('settings-panel').classList.contains('open') || t.w.eval('settingsOpen');
  t.prompt = () => d.getElementById('idle-overlay').classList.contains('visible');
  t.tap = (el = d.body) => el.dispatchEvent(new t.w.Event('pointerdown', { bubbles: true }));
  t.orgField = () => d.getElementById('in-org-name');
  return t;
}

test('3 minutes untouched in settings brings up "Still setting up?" with Keep editing focused; a tap before then restarts the clock', async () => {
  const t = boot();
  t.w.openSettings();
  await t.clock.tick(2 * MIN);
  t.tap(t.orgField());
  await t.clock.tick(2 * MIN);
  assert.equal(t.prompt(), false, 'the tap at 2 minutes restarted the 3');
  await t.clock.tick(1 * MIN + 1000);
  assert.equal(t.prompt(), true);
  await frame(t.w);
  assert.equal(t.w.document.activeElement.textContent, 'Keep editing');
});

test('no answer for 30 seconds: settings close to the stations, unsaved edits dropped', async () => {
  const t = boot();
  const saved = t.w.localStorage.getItem('rgxl_cfg');
  t.w.openSettings();
  t.w.selectChip(t.w.document.querySelector('.chip[data-group="size"][data-val="ultra"]'), 'size', 'ultra');
  await t.clock.tick(3 * MIN + 29 * 1000);
  assert.equal(t.prompt(), true);
  assert.ok(t.settingsOpen(), 'still open inside the 30 seconds');
  await t.clock.tick(2000);
  assert.equal(t.prompt(), false);
  assert.equal(t.settingsOpen(), false);
  assert.equal(t.w.document.getElementById('discard-overlay').classList.contains('visible'), false, 'no Discard question left behind');
  assert.notEqual(t.w.document.documentElement.dataset.size, 'ultra', 'the edit was dropped');
  assert.equal(t.w.localStorage.getItem('rgxl_cfg'), saved, 'nothing saved');
});

test('Keep editing (or Escape) closes the prompt, keeps every edit and starts the 3 minutes again', async () => {
  for (const how of ['tap', 'Escape']) {
    const t = boot();
    t.w.openSettings();
    t.orgField().value = 'Half typed';
    await t.clock.tick(3 * MIN + 10 * 1000);
    assert.equal(t.prompt(), true);
    const prompt = t.w.document.getElementById('idle-overlay');
    if (how === 'tap') prompt.querySelector('button').click();
    else t.w.document.dispatchEvent(new t.w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    assert.equal(t.prompt(), false, how);
    assert.ok(t.settingsOpen(), `${how}: settings stay open`);
    assert.equal(t.orgField().value, 'Half typed', `${how}: the edit is kept`);
    await t.clock.tick(2 * MIN);
    assert.equal(t.prompt(), false, `${how}: a fresh 3 minutes`);
    await t.clock.tick(1 * MIN + 1000);
    assert.equal(t.prompt(), true, `${how}: and it asks again after them`);
  }
});

test('a timeout closes whatever settings had open on top: the station browser, the Reset dialog', async () => {
  const t = boot();
  const d = t.w.document;
  t.w.openSettings();
  t.w.openStreamBrowser();
  await t.clock.tick(3 * MIN + 31 * 1000);
  assert.equal(t.settingsOpen(), false);
  assert.equal(d.getElementById('stream-browser-overlay').classList.contains('open'), false);

  t.w.openSettings();
  t.w.confirmReset();
  await t.clock.tick(3 * MIN + 31 * 1000);
  assert.equal(t.settingsOpen(), false);
  assert.equal(d.getElementById('reset-overlay').classList.contains('visible'), false);
  // Collapsed station rows inside settings are inert by design; nothing else may be.
  assert.deepEqual([...d.querySelectorAll('[inert]')].filter((el) => !el.closest('#settings-panel')).map((el) => el.id), [],
    'nothing left inert behind a closed dialog');
});

test('timing out never touches playback, moves no focus and says nothing (unhappy path: someone asleep with settings left open)', async () => {
  const t = boot({ cfg: { tts: 'on' } });
  t.w.playStream('s1');
  await t.clock.tick(10 * 1000); // past the delayed "Now playing"
  const src = t.audio.state.src;
  const fetches = t.audio.fetches.length;
  const volume = t.audio.volume;
  const spoken = t.spoken.length;
  const live = () => [...t.w.document.querySelectorAll('[aria-live], [role="status"]')].map((el) => el.textContent).join('|');
  t.w.openSettings();
  await frame(t.w);
  const before = live();
  await t.clock.tick(3 * MIN + 31 * 1000);
  await frame(t.w);
  assert.equal(t.settingsOpen(), false);
  assert.equal(t.audio.state.paused, false, 'still playing');
  assert.equal(t.audio.state.src, src);
  assert.equal(t.audio.fetches.length, fetches, 'nothing reloaded');
  assert.equal(t.audio.volume, volume);
  assert.equal(t.spoken.length, spoken, 'no speech');
  assert.equal(live(), before, 'no live region changed');
  assert.equal(t.w.document.activeElement, t.w.document.body, 'focus went nowhere');
});

test('paused, a timeout keeps the radio paused', async () => {
  const t = boot();
  t.w.playStream('s1');
  await t.clock.tick(CONNECT_MS);
  t.w.playStream('s1');
  await t.clock.tick(0);
  const fetches = t.audio.fetches.length;
  t.w.openSettings();
  await t.clock.tick(3 * MIN + 31 * 1000);
  assert.equal(t.audio.state.paused, true);
  assert.equal(t.audio.fetches.length, fetches);
});

test('the PIN pad closes itself after a minute with no key; a key restarts the minute', async () => {
  const t = boot();
  t.w.localStorage.setItem('rgxl_pin', '1234');
  const pad = t.w.document.getElementById('pin-overlay');
  t.w.showPinOverlay();
  await t.clock.tick(50 * 1000);
  t.tap(pad.querySelector('.pin-key'));
  t.w.pinKey('1');
  await t.clock.tick(50 * 1000);
  assert.ok(pad.classList.contains('visible'), 'the key at 50 s restarted the minute');
  await t.clock.tick(11 * 1000);
  assert.equal(pad.classList.contains('visible'), false);
  assert.equal(t.w.document.activeElement, t.w.document.body, 'focus went nowhere');
});

test('a lockout keeps counting when the pad times out and is opened again (unhappy path)', async () => {
  const t = boot();
  t.w.localStorage.setItem('rgxl_pin', '1234');
  const pad = t.w.document.getElementById('pin-overlay');
  t.w.showPinOverlay();
  for (let i = 0; i < 5; i++) {
    for (const d of '9999') t.w.pinKey(d);
    await t.clock.tick(300);
  }
  assert.match(t.w.document.getElementById('pin-status').textContent, /Wait \d+ seconds/);
  await t.clock.tick(61 * 1000);
  assert.equal(pad.classList.contains('visible'), false);
  t.w.showPinOverlay();
  assert.doesNotMatch(t.w.document.getElementById('pin-status').textContent, /Wait \d+ seconds/,
    'the 25 s lockout ran out while the pad was closed');
});

test('timing out with the guide or the emoji picker open moves no focus either (unhappy path)', async () => {
  for (const open of ['guide', 'emoji picker']) {
    const t = boot();
    const d = t.w.document;
    t.w.openSettings();
    await frame(t.w);
    if (open === 'guide') t.w.openHelp();
    else t.w.openEmojiPicker(0);
    await frame(t.w);
    const moves = [];
    d.addEventListener('focusin', (e) => moves.push(e.target.id || e.target.textContent.trim()), true);
    await t.clock.tick(3 * MIN + 1000);
    moves.length = 0; // focus on Keep editing is the prompt's own, and expected
    await t.clock.tick(31 * 1000);
    await frame(t.w);
    assert.equal(t.settingsOpen(), false, open);
    assert.deepEqual(moves, [], `${open}: nothing took focus on the way out`);
    assert.equal(d.activeElement, d.body, open);
  }
});


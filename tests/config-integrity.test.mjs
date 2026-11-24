/**
 * Saved config and backups stay sound: a malformed backup or tampered storage
 * can't break settings, a failed save is reported instead of swallowed, the
 * settings snapshot covers every setting, a config from a newer version
 * isn't silently half-applied or overwritten, and two stations sharing an id
 * both stay playable.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadApp } from './harness.mjs';
import { bootPlayback, CONNECT_MS } from './playback-fakes.mjs';

const URL_OK = 'https://ice.example.com/jazz';

/** Drive importConfig() through a File, as the hidden file input does.
    Resolves with the status line, or null if the import never reported. */
function importViaFile(w, text) {
  if (!w.document.getElementById('settings-panel').classList.contains('open')) w.openSettings();
  const file = new w.File([text], 'backup.json', { type: 'application/json' });
  const input = w.document.getElementById('import-file');
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  return new Promise((resolve) => {
    const statusEl = w.document.getElementById('backup-status');
    const obs = new w.MutationObserver(() => { obs.disconnect(); resolve(statusEl.textContent); });
    obs.observe(statusEl, { childList: true, characterData: true, subtree: true });
    setTimeout(() => { obs.disconnect(); resolve(null); }, 1000);
    w.importConfig({ target: input });
  });
}

/** Boot as a real cold start would, with storage already holding `stored`. */
function bootWithStored(stored) {
  return loadApp({ beforeParse: (win) => win.localStorage.setItem('rgxl_cfg', JSON.stringify(stored)) });
}

const storedCfg = (w) => JSON.parse(w.localStorage.getItem('rgxl_cfg'));
const editorEntries = (w) => w.document.querySelectorAll('#stream-editor [data-field="label"]').length;

// ── g15: fields inside each stream are type-checked ─────────────────────

test('a backup with a number as the description restores, and settings still open — unhappy path', async () => {
  const w = loadApp();
  const status = await importViaFile(w, JSON.stringify({ streams: [{ id: 's1', label: 'WDSE', sub: 103.3, url: URL_OK }] }));
  assert.match(status || '', /restored/i);
  w.closeSettings();
  w.openSettings();
  assert.equal(editorEntries(w), 1);
});

test('unknown keys, an object emoji and an unknown colour are dropped from a backup — unhappy path', async () => {
  const w = loadApp();
  await importViaFile(w, JSON.stringify({ streams: [
    { id: 's1', label: 'Jazz', url: URL_OK, emoji: { evil: 1 }, color: 'chartreuse', onclick: 'alert(1)', sub: 'Smooth' },
  ] }));
  assert.deepEqual(storedCfg(w).streams, [{ id: 's1', label: 'Jazz', sub: 'Smooth', url: URL_OK }]);
});

test('a backup keeps every valid stream field exactly', async () => {
  const w = loadApp();
  const stream = { id: 's1', label: 'Jazz', sub: 'Smooth', url: URL_OK, emoji: '🎷', color: 'teal', gain: 0.5 };
  await importViaFile(w, JSON.stringify({ streams: [stream] }));
  assert.deepEqual(storedCfg(w).streams, [stream]);
});

test('an oversized organisation name is cut to the 80 characters its field allows — unhappy path', async () => {
  const w = loadApp();
  await importViaFile(w, JSON.stringify({ orgName: 'x'.repeat(5000), streams: [{ id: 's1', label: 'Jazz', url: URL_OK }] }));
  assert.equal(storedCfg(w).orgName.length, 80);
});

test('tampered storage with a non-string field still lets settings open after a reboot — unhappy path', () => {
  const w = bootWithStored({ v: 1, streams: [{ id: 's1', label: 'WDSE', sub: 5, emoji: 7, url: URL_OK }] });
  w.openSettings();
  assert.equal(editorEntries(w), 1);
  assert.deepEqual(w.__bootErrors.map(String), []);
});

test('escAttr turns anything into a string instead of throwing', () => {
  const w = loadApp();
  assert.equal(w.escAttr(103.3), '103.3');
  assert.equal(w.escAttr(undefined), '');
  assert.equal(w.escAttr('"<a>'), '&quot;&lt;a&gt;');
});

// ── g28: a failed save is reported, not swallowed ───────────────────────

/** Make writes of `key` fail the way a full or blocked storage does. */
function failSaves(w, key = 'rgxl_cfg') {
  const setItem = w.Storage.prototype.setItem;
  w.Storage.prototype.setItem = function (k, v) {
    if (k === key) throw new w.DOMException('The quota has been exceeded.', 'QuotaExceededError');
    return setItem.call(this, k, v);
  };
  w.console.error = () => {};
}

const panelOpen = (w) => w.document.getElementById('settings-panel').classList.contains('open');
const applyStatus = (w) => w.document.getElementById('apply-status');

test('Apply that cannot save stays open and says so — unhappy path', async () => {
  const w = loadApp();
  w.openSettings();
  await new Promise((r) => w.requestAnimationFrame(() => r())); // the panel slides in on the next frame
  w.document.querySelector('.theme-modes [data-mode="dark"]').click();
  failSaves(w);
  w.applySettings();
  assert.ok(panelOpen(w), 'still open');
  assert.ok(!applyStatus(w).hidden);
  assert.match(applyStatus(w).textContent, /Couldn't save/);
  assert.equal(w.hasUnsavedChanges(), true, 'closing still offers to discard back to what is saved');
});

test('the save warning is gone on the next open', () => {
  const w = loadApp();
  w.openSettings();
  failSaves(w);
  w.applySettings();
  w.doCloseSettings();
  w.openSettings();
  assert.ok(applyStatus(w).hidden);
});

test('an import that cannot save says so and keeps the current settings — unhappy path', async () => {
  const w = loadApp();
  const theme = w.buildBackupPayload(false).theme;
  failSaves(w);
  const status = await importViaFile(w, JSON.stringify({ theme: theme === 'dark' ? 'light' : 'dark', streams: [{ id: 's1', label: 'Jazz', url: URL_OK }] }));
  assert.match(status || '', /Couldn't save/);
  assert.doesNotMatch(status || '', /restored/i);
  assert.equal(w.buildBackupPayload(false).theme, theme);
  assert.notEqual(w.buildBackupPayload(false).streams[0].label, 'Jazz');
});

// setBackupStatus() colours the line only for an error.
const backupStatusIsError = (w) => w.document.getElementById('backup-status').style.color !== '';
const storedPin = (w) => w.localStorage.getItem('rgxl_pin');

test('a restore whose new PIN cannot be saved says so, and the old PIN still applies — unhappy path', async () => {
  // REGRESSION: this said "Backup restored." while the device kept its old PIN.
  const w = loadApp({ seed: { rgxl_pin: '1111' } });
  failSaves(w, 'rgxl_pin');
  const logged = [];
  w.console.error = (...args) => logged.push(args.map(String).join(' '));
  const status = await importViaFile(w, JSON.stringify({ theme: 'mono-light', pin: '2468', streams: [{ id: 's1', label: 'Jazz', url: URL_OK }] }));
  assert.match(status || '', /PIN couldn't be saved/);
  assert.ok(backupStatusIsError(w), 'shown as an error');
  assert.equal(storedCfg(w).theme, 'mono-light', 'the settings still restored');
  assert.equal(storedCfg(w).streams[0].label, 'Jazz');
  assert.equal(storedPin(w), '1111');
  assert.equal(w.document.getElementById('in-pin').value, '1111', 'the PIN field shows the PIN in force');
  assert.ok(!logged.some((line) => line.includes('2468')), 'the PIN never reaches the log');
});

test('a restore that turns the PIN off, when that cannot be saved, says so and leaves the PIN on — unhappy path', async () => {
  const w = loadApp({ seed: { rgxl_pin: '1111' } });
  failSaves(w, 'rgxl_pin');
  const status = await importViaFile(w, JSON.stringify({ pin: '', streams: [{ id: 's1', label: 'Jazz', url: URL_OK }] }));
  assert.match(status || '', /PIN couldn't be saved/);
  assert.equal(storedPin(w), '1111');
});

test('a restore whose PIN saves still just says "Backup restored."', async () => {
  const w = loadApp({ seed: { rgxl_pin: '1111' } });
  const status = await importViaFile(w, JSON.stringify({ pin: '2468', streams: [{ id: 's1', label: 'Jazz', url: URL_OK }] }));
  assert.equal(status, 'Backup restored.');
  assert.ok(!backupStatusIsError(w));
  assert.equal(storedPin(w), '2468');
});

test('a backup without a PIN restores as before, even where the PIN cannot be saved', async () => {
  // It never asks to change the PIN, so there's nothing to warn about.
  const w = loadApp({ seed: { rgxl_pin: '1111' } });
  failSaves(w, 'rgxl_pin');
  const status = await importViaFile(w, JSON.stringify({ streams: [{ id: 's1', label: 'Jazz', url: URL_OK }] }));
  assert.equal(status, 'Backup restored.');
  assert.ok(!backupStatusIsError(w));
  assert.equal(storedPin(w), '1111');
});

// ── g29: the settings snapshot and Reset cover Auto-Resume and presets ──

const nextFrame = (w) => new Promise((r) => w.requestAnimationFrame(() => r()));

async function resetToDefaults(w) {
  w.openSettings();
  await nextFrame(w);
  w.confirmReset();
  w.executeReset();
}

test('Reset to Defaults turns Auto-Resume off and forgets the last station', async () => {
  const w = bootWithStored({ v: 1, resume: 'on', streams: [{ id: 's1', label: 'Jazz', url: URL_OK }] });
  w.localStorage.setItem('rgxl_last', 's1');
  await resetToDefaults(w);
  assert.equal(storedCfg(w).resume, 'off');
  assert.equal(w.localStorage.getItem('rgxl_last'), null, 'a relaunch has nothing to resume');
});

test('after Reset from a preset, opening and closing settings untouched asks nothing', async () => {
  const w = loadApp();
  w.openSettings();
  await nextFrame(w);
  w.applyPreset('Low Vision');
  w.applySettings();
  assert.equal(storedCfg(w).preset, 'Low Vision');
  await resetToDefaults(w);
  assert.equal(storedCfg(w).preset, 'Standard', 'the saved preset matches the reset values');
  w.openSettings();
  assert.equal(w.hasUnsavedChanges(), false);
});

test('turning Auto-Resume on and closing asks to discard, and discarding turns it back off', async () => {
  const w = loadApp();
  w.openSettings();
  await nextFrame(w);
  w.document.querySelector('.s-switch[data-switch="resume"]').click();
  assert.equal(w.hasUnsavedChanges(), true);
  w.closeSettings();
  assert.ok(w.document.getElementById('discard-overlay').classList.contains('visible'));
  w.confirmDiscard();
  assert.equal(w.buildBackupPayload(false).resume, 'off');
});

test('a stored preset name that no longer matches the settings is corrected on load — unhappy path', () => {
  // Low Vision's name over Standard's values (what Reset used to save).
  const w = bootWithStored({ v: 1, preset: 'Low Vision', streams: [{ id: 's1', label: 'Jazz', url: URL_OK }] });
  assert.equal(w.buildBackupPayload(false).preset, 'Standard');
});

// ── g30: a config or backup from a newer version ────────────────────────
// CFG_VERSION is 1; a v2 config is what a future version would write.

test('a backup from a newer version is refused, and nothing changes — unhappy path', async () => {
  const w = loadApp();
  const before = JSON.stringify(w.buildBackupPayload(false));
  const status = await importViaFile(w, JSON.stringify({ v: 2, theme: 'mono-light', streams: [{ id: 's1', label: 'Jazz', url: URL_OK }] }));
  assert.match(status || '', /newer version/);
  assert.match(status || '', /Nothing was changed/);
  assert.equal(JSON.stringify(w.buildBackupPayload(false)), before);
});

test('settings saved by a newer version load, but this version won\'t overwrite them — unhappy path', async () => {
  const stored = { v: 2, theme: 'dark', renamedInV2: 'keep me', streams: [{ id: 's1', label: 'Jazz', url: URL_OK }] };
  const w = bootWithStored(stored);
  assert.equal(w.buildBackupPayload(false).theme, 'dark', 'what validates still loads');
  w.openSettings();
  await nextFrame(w);
  w.document.querySelector('.theme-modes [data-mode="light"]').click();
  w.applySettings();
  assert.match(applyStatus(w).textContent, /newer version/);
  assert.deepEqual(storedCfg(w), stored, 'the newer config is untouched');
});

test('Reset to Defaults still starts over on a newer version\'s settings', async () => {
  const w = bootWithStored({ v: 2, theme: 'dark', streams: [{ id: 's1', label: 'Jazz', url: URL_OK }] });
  await resetToDefaults(w);
  assert.equal(storedCfg(w).v, 1);
  assert.equal(storedCfg(w).theme, 'auto');
});

// ── Two stations sharing an id ──────────────────────────────────────────
// The app finds a station by its id: its button ('btn-' + id), playStream,
// rgxl_last. Only a hand-made or tampered file can repeat one, and it used
// to leave the second station unplayable.

const URL_FOLK = 'https://ice.example.com/folk';
const SAME_ID = [
  { id: 's1', label: 'Jazz', url: URL_OK },
  { id: 's1', label: 'Folk', url: URL_FOLK },
];
// Array.from, so arrays read off the app's window compare equal to ours.
const ids = (streams) => Array.from(streams, (st) => st.id);
const idsAndLabels = (streams) => Array.from(streams, (st) => [st.id, st.label]);

test('a backup with two stations sharing an id restores both, and the first keeps its id — unhappy path', async () => {
  const w = loadApp();
  const status = await importViaFile(w, JSON.stringify({ streams: SAME_ID }));
  assert.match(status || '', /restored/i);
  assert.deepEqual(idsAndLabels(storedCfg(w).streams), [['s1', 'Jazz'], ['s1-2', 'Folk']]);
});

test('storage with two stations sharing an id loads both, each with its own id — unhappy path', () => {
  const w = bootWithStored({ v: 1, streams: SAME_ID });
  assert.deepEqual(idsAndLabels(w.buildBackupPayload(false).streams), [['s1', 'Jazz'], ['s1-2', 'Folk']]);
  assert.deepEqual(w.__bootErrors.map(String), []);
});

test('a new id skips one that a later station already has', () => {
  const w = bootWithStored({ v: 1, streams: [
    { id: 'a', label: 'One', url: URL_OK },
    { id: 'a', label: 'Two', url: URL_OK },
    { id: 'a-2', label: 'Three', url: URL_OK },
    { id: 'a', label: 'Four', url: URL_OK },
  ] });
  // Three keeps a-2: it was the first to have it.
  assert.deepEqual(ids(w.buildBackupPayload(false).streams), ['a', 'a-3', 'a-2', 'a-4']);
});

test('a 64-character id used twice gets a new id that still fits in 64 — unhappy path', async () => {
  const long = 'x'.repeat(64);
  const emoji = '🎵'.repeat(32); // also 64: .length counts each of these emoji as 2
  const w = loadApp();
  await importViaFile(w, JSON.stringify({ streams: [
    { id: long, label: 'One', url: URL_OK },
    { id: long, label: 'Two', url: URL_OK },
    { id: emoji, label: 'Three', url: URL_OK },
    { id: emoji, label: 'Four', url: URL_OK },
  ] }));
  // Cut whole emoji, never half of one.
  assert.deepEqual(ids(storedCfg(w).streams), [long, 'x'.repeat(62) + '-2', emoji, '🎵'.repeat(31) + '-2']);
  // An id over 64 would be dropped on the next launch, and its station with it.
  assert.equal(bootWithStored(storedCfg(w)).buildBackupPayload(false).streams.length, 4);
});

/** Playback fakes, with SAME_ID in storage from the first render on. */
const bootSameId = () => bootPlayback({ beforeParse: (win) => win.localStorage.setItem('rgxl_cfg', JSON.stringify({ v: 1, streams: SAME_ID })) });

test('each station gets its own button, and the second plays its own stream and stays paused after a call', async () => {
  const t = bootSameId();
  assert.equal(t.w.document.querySelectorAll('[id="btn-s1"]').length, 1, 'one button per id');
  t.button('s1-2').click();
  await t.clock.tick(CONNECT_MS);
  assert.equal(t.audio.state.src, URL_FOLK);
  assert.equal(t.label('s1-2'), 'Folk (on)');
  assert.equal(t.label('s1'), 'Jazz');

  // Standing rule: once paused, it stays paused.
  t.audio.externalPause(); // a call
  await t.clock.tick(60000);
  assert.equal(t.audio.state.paused, true);
  assert.equal(t.status('s1-2'), 'Tap to play');
  assert.equal(t.status('s1'), '', 'only the station that was paused says so');
});

test('removing the second station in the editor leaves the first one playing', async () => {
  const t = bootSameId();
  t.button('s1').click();
  await t.clock.tick(CONNECT_MS);
  t.w.openSettings();
  t.w.document.querySelector('.stream-entry[data-idx="1"] [data-action="remove"]').click();
  await t.clock.tick(CONNECT_MS);
  assert.equal(t.audio.state.paused, false);
  assert.equal(t.audio.state.src, URL_OK);
  assert.equal(t.label('s1'), 'Jazz (on)');
});

test('the second station has the same new id on the next launch, so Auto-Resume finds it, and only with Resume on', () => {
  const t = bootSameId();
  t.button('s1-2').click();
  const last = t.w.localStorage.getItem('rgxl_last');
  t.w.stopPlayback();

  // Storage still holds both as s1 (nothing was saved); rgxl_last says s1-2.
  const launch = (resume) => loadApp({
    beforeParse(win) {
      win.localStorage.setItem('rgxl_cfg', JSON.stringify({ v: 1, resume, streams: SAME_ID }));
      win.localStorage.setItem('rgxl_last', last);
    },
  });
  const resumed = launch('on');
  assert.equal(resumed.document.getElementById('btn-s1-2').getAttribute('aria-current'), 'true', 'Folk is playing');
  assert.equal(resumed.document.getElementById('btn-s1').getAttribute('aria-current'), null, 'Jazz is not');
  resumed.close(); // real timers here: playback would hold the process open

  // Standing rule: with Resume off, a launch starts nothing.
  const stayed = launch('off');
  const labels = Array.from(stayed.document.querySelectorAll('.stream-btn'), (b) => b.getAttribute('aria-label') + ' ' + b.getAttribute('aria-current'));
  assert.deepEqual(labels, ['Jazz null', 'Folk null']);
  stayed.close();
});

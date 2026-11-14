/**
 * Behavioral tests for RadioGridXL's persistence, validation, and PIN logic —
 * the surface where the v7.x bugs lived. Run with: npm run test:dom
 *
 * These complement (don't replace) two other layers:
 *   - smoke-test.mjs : static source/structure/invariant checks
 *   - on-device CDP  : real-WebView layout + UI flows (renderButtons clipping,
 *                      overlays, live PIN entry).
 */
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { loadApp } from './harness.mjs';

/** Round-trip helper: persist current cfg and read back the validated object. */
function savedCfg(window) {
  window.saveSettings();
  return JSON.parse(window.localStorage.getItem('rgxl_cfg'));
}

// ─────────────────────────────────────────────────────────────────────────
test('harness boots the app and exposes functions', () => {
  const w = loadApp();
  assert.equal(w.document.title, 'RadioGridXL');
  for (const fn of ['getPin', 'setPin', 'sanitizeStoredPin', 'loadSettings', 'saveSettings', 'applySettings', 'isValidStreamUrl']) {
    assert.equal(typeof w[fn], 'function', `${fn} should be defined`);
  }
});

// ── init() boots cleanly on every platform ───────────────────────────────
test('init() completes without error on the Android target', () => {
  const w = loadApp();
  assert.deepEqual(w.__bootErrors.map(e => e.message), [], 'no errors during boot');
  // A fully-completed init() attaches the resize listener and syncs chips.
  assert.equal(w.document.getElementById('logo-svg') !== null, true);
});

test('init() completes without error on desktop (no dead element references)', () => {
  // REGRESSION: init()'s desktop branch referenced a removed #vol-overlay-body,
  // throwing on null and aborting boot on any desktop browser.
  const w = loadApp({ desktop: true });
  assert.deepEqual(w.__bootErrors.map(e => e.message), [], 'desktop boot must not throw');
});

// ── isValidStreamUrl (pure allowlist) ────────────────────────────────────
test('isValidStreamUrl accepts only http(s) and empty', () => {
  const { isValidStreamUrl } = loadApp();
  assert.equal(isValidStreamUrl('https://ice.example.com/stream'), true);
  assert.equal(isValidStreamUrl('http://example.com:8000/live'), true, 'plain http allowed (radio streams use it)');
  assert.equal(isValidStreamUrl(''), true, 'empty URL allowed (stream just will not play)');
  assert.equal(isValidStreamUrl('  https://x.com  '), true, 'leading/trailing whitespace tolerated');
});

test('isValidStreamUrl rejects dangerous schemes (unhappy path)', () => {
  const { isValidStreamUrl } = loadApp();
  for (const bad of ['javascript:alert(1)', 'data:text/html,<script>', 'file:///etc/passwd', 'ftp://host/x', 'vbscript:x', 'JAVASCRIPT:alert(1)']) {
    assert.equal(isValidStreamUrl(bad), false, `${bad} must be rejected`);
  }
});

// ── getPin / setPin disable semantics ────────────────────────────────────
test('getPin returns the profile default on a fresh install', () => {
  assert.equal(loadApp({ profile: 'example-org' }).getPin(), '2580', 'branded default PIN');
  assert.equal(loadApp().getPin(), '', 'generic profile ships with no PIN');
});

test('setPin then getPin round-trips', () => {
  const w = loadApp({ profile: 'example-org' });
  w.setPin('1357');
  assert.equal(w.getPin(), '1357');
  assert.equal(w.localStorage.getItem('rgxl_pin'), '1357');
});

test('REGRESSION: a deliberately-cleared PIN stays disabled, does not snap back to the profile default', () => {
  // The bug: `stored || PIN_DEFAULT` treated '' as falsy, so disabling the PIN
  // on a branded profile silently re-enabled the default (e.g. 2580) and it
  // could never be turned off. Fix uses `stored !== null ? stored : default`.
  const w = loadApp({ profile: 'example-org' });
  w.setPin('');
  assert.equal(w.getPin(), '', 'cleared PIN must remain cleared, not become 2580');
  assert.equal(w.localStorage.getItem('rgxl_pin'), '');
});

// ── sanitizeStoredPin self-heal ──────────────────────────────────────────
test('sanitizeStoredPin drops a non-4-digit (unenterable) stored PIN, restoring the default', () => {
  for (const bad of ['12', '99999', 'ab12', '1 23']) {
    const w = loadApp({ profile: 'example-org', seed: { rgxl_pin: bad } });
    assert.equal(w.localStorage.getItem('rgxl_pin'), null, `${JSON.stringify(bad)} should be removed`);
    assert.equal(w.getPin(), '2580', 'falls back to the enterable profile default');
  }
});

test('sanitizeStoredPin keeps a valid 4-digit PIN and leaves an intentional empty PIN alone', () => {
  const good = loadApp({ profile: 'example-org', seed: { rgxl_pin: '2580' } });
  assert.equal(good.localStorage.getItem('rgxl_pin'), '2580');

  const disabled = loadApp({ profile: 'example-org', seed: { rgxl_pin: '' } });
  assert.equal(disabled.localStorage.getItem('rgxl_pin'), '', 'empty string is a deliberate disable, not corruption');
  assert.equal(disabled.getPin(), '');
});

// ── loadSettings validation / fallback ───────────────────────────────────
test('loadSettings falls back to defaults on corrupt JSON (unhappy path)', () => {
  const w = loadApp({ seed: { rgxl_cfg: '{ not valid json' } });
  const c = savedCfg(w);
  assert.equal(c.theme, 'auto');
  assert.equal(c.size, 'large');
  assert.equal(c.streams.length, 2, 'default streams retained');
});

test('loadSettings rejects values outside the allowlist, keeps valid ones', () => {
  const w = loadApp({ seed: { rgxl_cfg: JSON.stringify({
    theme: 'hotpink', size: 'enormous', fillview: 'maybe',   // all invalid → defaults
    advanced: 'on', volume: 42,                              // valid → applied
  }) } });
  const c = savedCfg(w);
  assert.equal(c.theme, 'auto', 'invalid theme rejected');
  assert.equal(c.size, 'large', 'invalid size rejected');
  assert.equal(c.fillview, 'on', 'invalid fillview rejected');
  assert.equal(c.advanced, 'on', 'valid advanced applied');
  assert.equal(c.volume, 42, 'valid volume applied');
});

test('loadSettings clamps/rounds volume and rejects out-of-range', () => {
  assert.equal(savedCfg(loadApp({ seed: { rgxl_cfg: '{"volume":50.6}' } })).volume, 51, 'rounded');
  assert.equal(savedCfg(loadApp({ seed: { rgxl_cfg: '{"volume":150}' } })).volume, 100, 'over-range rejected → default');
  assert.equal(savedCfg(loadApp({ seed: { rgxl_cfg: '{"volume":-5}' } })).volume, 100, 'negative rejected → default');
});

test('loadSettings re-validates stream URLs from storage (defense in depth)', () => {
  const w = loadApp({ seed: { rgxl_cfg: JSON.stringify({ streams: [
    { id: 's1', label: 'Good', url: 'https://ice.example.com/a' },
    { id: 's2', label: 'Evil', url: 'javascript:alert(document.cookie)' },
    { id: 's3', label: 'PlainHttp', url: 'http://radio.example.com/live' },
  ] }) } });
  const c = savedCfg(w);
  assert.equal(c.streams.length, 3);
  assert.equal(c.streams[0].url, 'https://ice.example.com/a', 'valid https kept');
  assert.equal(c.streams[1].url, '', 'javascript: URL blanked on load');
  assert.equal(c.streams[2].url, 'http://radio.example.com/live', 'plain http kept');
});

test('loadSettings filters stream entries missing required fields', () => {
  const w = loadApp({ seed: { rgxl_cfg: JSON.stringify({ streams: [
    { id: 's1', label: 'Keep', url: 'https://x.com/a' },
    { label: 'NoId', url: 'https://x.com/b' },   // missing id → dropped
    { id: 's3', url: 'https://x.com/c' },         // missing label → dropped
  ] }) } });
  const c = savedCfg(w);
  assert.equal(c.streams.length, 1);
  assert.equal(c.streams[0].label, 'Keep');
});

test('loadSettings falls back to default streams when every entry is invalid', () => {
  const w = loadApp({ seed: { rgxl_cfg: JSON.stringify({ streams: [{ foo: 1 }, { bar: 2 }] }) } });
  assert.equal(savedCfg(w).streams.length, 2, 'reverts to PROFILE.streams');
});

test('loadSettings rejects an over-cap (>8) streams array wholesale', () => {
  const nine = Array.from({ length: 9 }, (_, i) => ({ id: 's' + i, label: 'S' + i, url: 'https://x.com/' + i }));
  const w = loadApp({ seed: { rgxl_cfg: JSON.stringify({ streams: nine }) } });
  assert.equal(savedCfg(w).streams.length, 2, 'oversized array ignored, defaults kept');
});

// ── Schema version ────────────────────────────────────────────────────────
test('saveSettings always stamps the current schema version', () => {
  assert.equal(savedCfg(loadApp()).v, 1);
});

test('loadSettings reads a legacy (no-version) config without resetting it', () => {
  const w = loadApp({ seed: { rgxl_cfg: JSON.stringify({ theme: 'dark', size: 'xlarge' }) } });
  const c = savedCfg(w);
  assert.equal(c.theme, 'dark', 'legacy values still honored');
  assert.equal(c.size, 'xlarge');
  assert.equal(c.v, 1, 're-saved with current version');
});

// ── applySettings PIN rules (DOM path) ────────────────────────────────────
function applyPin(window, raw) {
  window.openSettings();   // Apply only acts on an open panel
  window.document.getElementById('in-pin').value = raw;
  window.applySettings();
  return window.getPin();
}

test('applySettings accepts a 4-digit PIN and an empty (disable) PIN', () => {
  const w = loadApp({ profile: 'example-org' });
  assert.equal(applyPin(w, '1234'), '1234', 'exactly 4 digits saved');
  assert.equal(applyPin(w, ''), '', 'empty disables the PIN');
});

test('applySettings rejects non-4-digit PINs, leaving the existing PIN intact (unhappy path)', () => {
  // The unlock pad is fixed at 4 digits, so saving any other length would lock
  // the technician out entirely — these must be silently rejected. Nothing is
  // ever written for a rejected value, so getPin keeps returning the default.
  const w = loadApp({ profile: 'example-org' });          // default 2580, nothing stored
  assert.equal(applyPin(w, '12'), '2580', '2 digits rejected');
  assert.equal(applyPin(w, '123456'), '2580', '6 digits rejected');
});

test('applySettings strips non-digits before length-checking the PIN', () => {
  assert.equal(applyPin(loadApp({ profile: 'example-org' }), '1a2b3c4d'), '1234', 'digits extracted → valid 4 saved');
  // "9-9" extracts to "99" (length 2) → rejected → branded default intact.
  assert.equal(applyPin(loadApp({ profile: 'example-org' }), '9-9'), '2580');
});

// ── Backup / Restore (export ↔ import round-trip) ─────────────────────────

/**
 * Build the export payload via the REAL exportConfig() field-list builder
 * (the download itself can't run in jsdom — URL.createObjectURL is unimplemented
 * — but buildBackupPayload() IS the content a restore consumes). Calling it
 * directly means this test fails if buildBackupPayload() ever drifts from
 * saveSettings(), instead of silently dropping a field from backups.
 * includePin=true mirrors ticking the opt-in "Include PIN" checkbox.
 */
function exportPayload(window) {
  return window.buildBackupPayload(true);
}

/**
 * Drive the real importConfig() through a File, the same path the file <input>
 * uses. Resolves once FileReader.onload (or onerror) has run and the import has
 * been applied. Returns the backup-status text so the caller can assert
 * success vs. the rejection message.
 */
function importViaFile(window, text) {
  window.openSettings();   // Import lives in the settings panel and only acts while it's open
  const file = new window.File([text], 'backup.json', { type: 'application/json' });
  const input = window.document.getElementById('import-file');
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  return new Promise((resolve) => {
    const statusEl = window.document.getElementById('backup-status');
    const obs = new window.MutationObserver(() => {
      obs.disconnect();
      resolve(statusEl.textContent);
    });
    obs.observe(statusEl, { childList: true, characterData: true, subtree: true });
    window.importConfig({ target: input });
  });
}

test('export → clear storage → import round-trips the config exactly', async () => {
  // Start from a non-default, branded config so the round-trip has something to lose.
  const src = loadApp({ profile: 'example-org' });
  src.localStorage.setItem('rgxl_cfg', JSON.stringify({
    v: 1, theme: 'mono-dark', size: 'ultra', fillview: 'off', volume: 73,
    advanced: 'on', haptics: 'off', tts: 'on', chime: 'off', resume: 'on', orientation: 'landscape-cw',
    orgName: 'My Room',
    streams: [{ id: 'a', label: 'Jazz', url: 'https://ice.example.com/jazz', gain: 0.5 }],
  }));
  src.loadSettings();
  src.setPin('2468');
  const payload = exportPayload(src);
  const json = JSON.stringify(payload);

  // Fresh device (different profile, empty storage) imports the backup.
  const dst = loadApp();
  const status = await importViaFile(dst, json);
  assert.match(status, /restored/i, 'success message shown');

  const c = JSON.parse(dst.localStorage.getItem('rgxl_cfg'));
  assert.equal(c.theme, 'mono-dark');
  assert.equal(c.size, 'ultra');
  assert.equal(c.fillview, 'off');
  assert.equal(c.volume, 73);
  assert.equal(c.advanced, 'on');
  assert.equal(c.haptics, 'off');
  assert.equal(c.tts, 'on');
  assert.equal(c.chime, 'off');
  assert.equal(c.resume, 'on');
  assert.equal(c.orientation, 'landscape-cw');
  assert.equal(c.orgName, 'My Room');
  assert.deepEqual(c.streams, [{ id: 'a', label: 'Jazz', url: 'https://ice.example.com/jazz', gain: 0.5 }], 'per-stream gain trim survives the round-trip');
  assert.equal(dst.getPin(), '2468', 'PIN restored from the backup');
});

test('buildBackupPayload covers exactly the saveSettings field set, PIN only when opted in', () => {
  const w = loadApp({ profile: 'example-org' });
  w.setPin('1357');

  // Without the opt-in, the PIN must NOT be in the file (it travels off-device).
  const without = w.buildBackupPayload(false);
  assert.equal('pin' in without, false, 'PIN omitted by default');

  // With the opt-in, the PIN is included.
  const withPin = w.buildBackupPayload(true);
  assert.equal(withPin.pin, '1357', 'PIN included when opted in');

  // The non-PIN field set must match exactly what saveSettings() persists —
  // this is the drift guard: a field added to one but not the other fails here.
  const savedKeys = Object.keys(savedCfg(w)).sort();
  const exportKeys = Object.keys(without).sort();
  assert.deepEqual(exportKeys, savedKeys, 'export field list matches saveSettings() (no drift)');
});

test('import rejects malformed JSON and leaves the existing config intact (unhappy path)', async () => {
  const w = loadApp({ profile: 'example-org', seed: { rgxl_cfg: JSON.stringify({
    v: 1, theme: 'dark', size: 'normal', volume: 30,
  }), rgxl_pin: '2580' } });
  const before = w.localStorage.getItem('rgxl_cfg');

  const status = await importViaFile(w, '{ this is not: valid json ]');
  assert.match(status, /not valid json|nothing was changed/i, 'rejection surfaced to the user');
  assert.equal(w.localStorage.getItem('rgxl_cfg'), before, 'live config untouched after a bad import');
  assert.equal(w.getPin(), '2580', 'PIN untouched after a bad import');
});

test('import rejects a structurally-valid file with no recognizable settings (unhappy path)', async () => {
  const w = loadApp({ seed: { rgxl_cfg: JSON.stringify({ v: 1, theme: 'light', volume: 80 }) } });
  const before = w.localStorage.getItem('rgxl_cfg');

  // Well-formed JSON, but nothing matches the allowlist → must not clobber cfg.
  const status = await importViaFile(w, JSON.stringify({ hello: 'world', nope: 123 }));
  assert.match(status, /no valid settings|nothing was changed/i);
  assert.equal(w.localStorage.getItem('rgxl_cfg'), before, 'live config untouched');
});

test('import sanitizes hostile values rather than trusting the file (mass-assignment guard)', async () => {
  const w = loadApp({ seed: { rgxl_cfg: JSON.stringify({ v: 1, theme: 'dark', volume: 50 }) } });
  const status = await importViaFile(w, JSON.stringify({
    v: 1,
    theme: 'evil-theme',                       // not in allowlist → ignored, keeps existing
    volume: 99,                                // valid → applied
    streams: [{ id: 'x', label: 'XSS', url: 'javascript:alert(1)' }], // url blanked
    pin: '99',                                 // not 4 digits → ignored
    isAdmin: true,                             // junk field → never assigned
  }));
  assert.match(status, /restored/i);
  const c = JSON.parse(w.localStorage.getItem('rgxl_cfg'));
  assert.equal(c.theme, 'dark', 'invalid theme ignored, prior value kept');
  assert.equal(c.volume, 99, 'valid volume applied');
  assert.equal(c.streams[0].url, '', 'javascript: URL blanked on import');
  assert.equal(c.isAdmin, undefined, 'unknown field never assigned (no mass assignment)');
  assert.equal(w.getPin(), '', 'non-conforming PIN ignored; generic default (no PIN) preserved');
});

// ── Auto-resume last station (cfg.resume + rgxl_last) ─────────────────────

test('cfg.resume defaults to off and round-trips through save/load', () => {
  assert.equal(savedCfg(loadApp()).resume, 'off', 'fresh install boots with auto-resume off');

  const w = loadApp({ seed: { rgxl_cfg: JSON.stringify({ resume: 'on' }) } });
  assert.equal(savedCfg(w).resume, 'on', 'stored on value honored and re-saved');
});

test('loadSettings rejects an out-of-allowlist resume value (unhappy path)', () => {
  const w = loadApp({ seed: { rgxl_cfg: JSON.stringify({ resume: 'maybe' }) } });
  assert.equal(savedCfg(w).resume, 'off', 'invalid resume falls back to default');
});

test('playStream writes the started stream id to the separate rgxl_last key', () => {
  // jsdom cannot truly play audio, but playStream's bookkeeping (set playing,
  // persist rgxl_last) runs synchronously before any media event. Assert the
  // side effect that auto-resume depends on.
  const w = loadApp();
  const c = JSON.parse(w.localStorage.getItem('rgxl_cfg') || '{}');
  // Use whatever the first default stream id is, so this stays profile-agnostic.
  w.saveSettings();
  const firstId = JSON.parse(w.localStorage.getItem('rgxl_cfg')).streams[0].id;
  assert.equal(w.localStorage.getItem('rgxl_last'), null, 'nothing remembered before any play');
  w.playStream(firstId);
  assert.equal(w.localStorage.getItem('rgxl_last'), firstId, 'last-played id persisted');
});

test('maybeAutoResume targets the stored station when resume is on and the id is current', () => {
  const w = loadApp({ seed: { rgxl_cfg: JSON.stringify({ resume: 'on' }) } });
  const firstId = (w.saveSettings(), JSON.parse(w.localStorage.getItem('rgxl_cfg')).streams[0].id);
  w.localStorage.setItem('rgxl_last', firstId);
  const targeted = w.maybeAutoResume();
  assert.equal(targeted, firstId, 'returns the id it auto-started');
});

test('maybeAutoResume is a no-op when resume is off (default boot stays stopped)', () => {
  const w = loadApp(); // resume defaults to off
  const firstId = (w.saveSettings(), JSON.parse(w.localStorage.getItem('rgxl_cfg')).streams[0].id);
  w.localStorage.setItem('rgxl_last', firstId);
  assert.equal(w.maybeAutoResume(), null, 'opt-in only — does nothing with resume off');
});

test('maybeAutoResume ignores a stale/removed rgxl_last id without erroring', () => {
  const w = loadApp({ seed: { rgxl_cfg: JSON.stringify({ resume: 'on' }) } });
  w.localStorage.setItem('rgxl_last', 'no-such-stream-id');
  assert.doesNotThrow(() => {
    assert.equal(w.maybeAutoResume(), null, 'stale id resolves to nothing → stay stopped');
  });
});

test('maybeAutoResume is a no-op when no station was ever remembered', () => {
  const w = loadApp({ seed: { rgxl_cfg: JSON.stringify({ resume: 'on' }) } });
  assert.equal(w.localStorage.getItem('rgxl_last'), null);
  assert.equal(w.maybeAutoResume(), null, 'missing rgxl_last → nothing to resume');
});

// ── Loudness leveling — per-stream gain trim only ─────────────────────────
// The global Web Audio compressor was removed (it silenced cross-origin
// streams that send no CORS headers — confirmed on-device). Leveling is now
// purely the per-stream `gain` trim (see targetVolume + sanitizeGain below).

test('the removed global-leveling toggle is gone: cfg has no leveling key, and a stored one is ignored', () => {
  assert.equal('leveling' in savedCfg(loadApp()), false, 'no leveling key in a fresh persisted config');

  // A legacy/tampered config carrying `leveling` must be dropped (not persisted)
  // — validateConfig omits unknown keys; nothing migrates or re-saves it.
  const w = loadApp({ seed: { rgxl_cfg: JSON.stringify({ leveling: 'on', theme: 'dark' }) } });
  const c = savedCfg(w);
  assert.equal('leveling' in c, false, 'stored leveling key is not carried forward');
  assert.equal(c.theme, 'dark', 'other valid fields still load');

  // The Web Audio entry points no longer exist on the app surface.
  assert.equal(typeof w.engageLeveling, 'undefined', 'engageLeveling removed');
  assert.equal(typeof w.applyLeveling, 'undefined', 'applyLeveling removed');
});

// ── Per-stream gain trim (sanitizeGain validation) ────────────────────────

test('sanitizeGain accepts finite numbers in [0.1, 4], rejects everything else', () => {
  const { sanitizeGain } = loadApp();
  assert.equal(sanitizeGain(0.5), 0.5, 'in-range attenuation kept');
  assert.equal(sanitizeGain(2), 2, 'in-range boost kept');
  assert.equal(sanitizeGain('1.5'), 1.5, 'numeric string parsed');
  assert.equal(sanitizeGain(1), null, '1.0 is the default — stored as nothing');
  assert.equal(sanitizeGain(0), null, 'below min rejected');
  assert.equal(sanitizeGain(0.05), null, 'below min rejected');
  assert.equal(sanitizeGain(4.1), null, 'above max rejected');
  assert.equal(sanitizeGain(NaN), null, 'NaN rejected');
  assert.equal(sanitizeGain(Infinity), null, 'Infinity rejected');
  assert.equal(sanitizeGain('loud'), null, 'non-numeric string rejected');
  assert.equal(sanitizeGain(''), null, 'empty string → no trim');
  assert.equal(sanitizeGain(null), null, 'null → no trim');
  assert.equal(sanitizeGain(undefined), null, 'undefined → no trim');
});

test('loadSettings validates per-stream gain like URLs — bad values dropped, good kept', () => {
  const w = loadApp({ seed: { rgxl_cfg: JSON.stringify({ streams: [
    { id: 's1', label: 'Trim',  url: 'https://x.com/a', gain: 0.5 },          // valid → kept
    { id: 's2', label: 'Loud',  url: 'https://x.com/b', gain: 999 },          // out-of-range → dropped
    { id: 's3', label: 'Junk',  url: 'https://x.com/c', gain: 'blast' },      // non-numeric → dropped
    { id: 's4', label: 'Plain', url: 'https://x.com/d' },                     // no gain → stays absent
  ] }) } });
  const c = savedCfg(w);
  assert.equal(c.streams.length, 4);
  assert.equal(c.streams[0].gain, 0.5, 'valid gain kept');
  assert.equal(c.streams[1].gain, undefined, 'out-of-range gain dropped (defaults to 1.0)');
  assert.equal(c.streams[2].gain, undefined, 'non-numeric gain dropped');
  assert.equal(c.streams[3].gain, undefined, 'absent gain stays absent');
});

test('targetVolume() applies the playing stream gain to playback and clamps to [0,1]', () => {
  // The OUTPUT side of per-stream gain: validating the stored value is moot if
  // it never reaches the speaker correctly. targetVolume() reads cfg.volume, the
  // currently-`playing` id, and that stream's gain. playStream() sets `playing`.
  const w = loadApp({ seed: { rgxl_cfg: JSON.stringify({ volume: 100, streams: [
    { id: 'q', label: 'Quiet', url: 'https://x.com/q', gain: 0.5 },
    { id: 'l', label: 'Loud',  url: 'https://x.com/l', gain: 2 },
    { id: 'p', label: 'Plain', url: 'https://x.com/p' },
  ] }) } });

  assert.equal(w.targetVolume(), 1, 'nothing playing → master volume (1.0)');

  w.playStream('q');
  assert.equal(w.targetVolume(), 0.5, 'gain 0.5 at full volume → 0.5 (gain reaches output)');

  w.playStream('l');
  assert.equal(w.targetVolume(), 1, 'gain 2 at full volume → clamped to 1.0, never 2 (HTML5 volume would reject >1)');

  w.playStream('p');
  assert.equal(w.targetVolume(), 1, 'no gain → master volume unchanged');
});

test('import sanitizes a hostile per-stream gain (mass-assignment / range guard)', async () => {
  const w = loadApp({ seed: { rgxl_cfg: JSON.stringify({ v: 1, theme: 'dark', volume: 50 }) } });
  const status = await importViaFile(w, JSON.stringify({
    v: 1,
    leveling: 'on',   // removed feature — must be ignored on import, not carried in
    streams: [
      { id: 'a', label: 'Sane',   url: 'https://x.com/a', gain: 1.5 },
      { id: 'b', label: 'Insane', url: 'https://x.com/b', gain: 1e9 },   // absurd → dropped
    ],
  }));
  assert.match(status, /restored/i);
  const c = JSON.parse(w.localStorage.getItem('rgxl_cfg'));
  assert.equal('leveling' in c, false, 'removed leveling key ignored on import, not carried in');
  assert.equal(c.streams[0].gain, 1.5, 'sane imported gain kept');
  assert.equal(c.streams[1].gain, undefined, 'absurd imported gain dropped, not trusted');
});

// ── MediaSession metadata mapping (Feature 2) ─────────────────────────────
// jsdom has no real MediaSession/MediaMetadata, so the DOM-side wiring (lock
// screen, background audio, call interruption) is verified on-device in Chrome
// for Android. Here we cover the pure, testable surface: the metadata-mapping
// helper and that the API-touching wrappers no-op (don't throw) when absent.

test('buildMediaMetadata maps stream label/sub + org name to title/artist/album', () => {
  const w = loadApp();
  const stream = { id: 's1', label: 'Groove Salad', sub: 'Ambient 24/7', url: 'https://x/y' };
  const meta = w.buildMediaMetadata(stream, 'Example Center');
  assert.equal(meta.title, 'Groove Salad');
  assert.equal(meta.artist, 'Ambient 24/7');
  assert.equal(meta.album, 'Example Center');
  assert.ok(Array.isArray(meta.artwork), 'artwork is an array');
});

test('buildMediaMetadata returns null when there is no stream', () => {
  const w = loadApp();
  assert.equal(w.buildMediaMetadata(null, 'Org'), null);
  assert.equal(w.buildMediaMetadata(undefined, 'Org'), null);
});

test('buildMediaMetadata tolerates a stream missing label/sub (empty strings, no throw)', () => {
  const w = loadApp();
  const meta = w.buildMediaMetadata({ id: 's1' }, '');
  assert.equal(meta.title, '');
  assert.equal(meta.artist, '');
  assert.equal(meta.album, '');
});

test('mediaArtwork builds a self-contained data: URI from the inline logo (no external src)', () => {
  const w = loadApp({ profile: 'example-org' });
  const art = w.mediaArtwork();
  assert.ok(Array.isArray(art));
  if (art.length) {
    assert.match(art[0].src, /^data:image\/svg\+xml,/, 'artwork is an inline data URI, not a network URL');
    assert.doesNotMatch(art[0].src, /https?:\/\//, 'no http(s) artwork URL — keeps file:// self-containment');
  }
});

test('media wrappers no-op without mediaSession (bare WebView path) — never throw', () => {
  const w = loadApp(); // jsdom: navigator has no mediaSession
  assert.equal('mediaSession' in w.navigator, false, 'precondition: jsdom lacks mediaSession');
  assert.doesNotThrow(() => {
    w.applyMediaMetadata({ id: 's1', label: 'L', sub: 'S' });
    w.setMediaPlaybackState('playing');
    w.registerMediaSessionHandlers();
  }, 'all MediaSession entry points must degrade silently when the API is absent');
});

// ── Accessibility presets (cfg.preset + applyPreset) ──────────────────────
// PRESETS is a top-level const (not on window, like PALETTE/PROFILE), so the
// data-driven assertions read the chips the UI renders from it and the cfg
// fields applyPreset() writes — i.e. the observable contract of the const.

/** The preset names the picker renders (proves the list is data-driven). */
function presetChipVals(window) {
  window.openSettings();
  return [...window.document.querySelectorAll('.chip[data-group="preset"]')]
    .map(c => c.dataset.val);
}

test('preset picker renders the built-in presets, data-driven from PRESETS', () => {
  const w = loadApp();
  const vals = presetChipVals(w);
  assert.deepEqual(vals, ['Standard', 'Low Vision', 'Simplest', 'custom'],
    'one chip per PRESETS entry, in declared order, then the Custom marker');
});

test('cfg.preset defaults to Standard and round-trips through save/load', () => {
  assert.equal(savedCfg(loadApp()).preset, 'Standard', 'fresh install boots on the Standard preset');

  // The name is derived from the settings on load, so it survives a round-trip
  // when the settings match it (a stale name is tested in config-integrity).
  const lowVision = { theme: 'contrast-dark', size: 'ultra', advanced: 'off', haptics: 'on', tts: 'on', chime: 'on', fillview: 'on' };
  const w = loadApp({ seed: { rgxl_cfg: JSON.stringify({ preset: 'Low Vision', ...lowVision }) } });
  assert.equal(savedCfg(w).preset, 'Low Vision', 'stored preset name honored and re-saved');
});

test('loadSettings ignores an unknown preset name (falls back to default)', () => {
  const w = loadApp({ seed: { rgxl_cfg: JSON.stringify({ preset: 'Bespoke' }) } });
  assert.equal(savedCfg(w).preset, 'Standard', 'unknown preset → default, never trusted');
});

test('loadSettings keeps "custom" when the settings match no preset', () => {
  const w = loadApp({ seed: { rgxl_cfg: JSON.stringify({ preset: 'custom', theme: 'mono-dark', size: 'normal' }) } });
  assert.equal(savedCfg(w).preset, 'custom', 'custom is a valid stored value (manual fine-tuning)');
});

test('applyPreset("Low Vision") applies its full display/interaction bundle and persists', () => {
  const w = loadApp();
  w.openSettings();
  w.applyPreset('Low Vision');
  const c = savedCfg(w);
  // The bundle from the PRESETS const, asserted field-by-field.
  assert.equal(c.preset, 'Low Vision');
  assert.equal(c.theme, 'contrast-dark', 'High Contrast Dark');
  assert.equal(c.size, 'ultra', 'largest text');
  assert.equal(c.tts, 'on', 'voice announcements on');
  assert.equal(c.advanced, 'off');
});

test('a device on the old Low Vision (MonoRadio Dark) keeps its theme and shows Custom — unhappy path', () => {
  // Low Vision moved to High Contrast Dark. An update must not repaint a
  // device someone set up: its saved theme stays, and the name it can no
  // longer claim self-corrects to custom.
  const oldLowVision = { preset: 'Low Vision', theme: 'mono-dark', size: 'ultra', advanced: 'off', haptics: 'on', tts: 'on', chime: 'on', fillview: 'on' };
  const c = savedCfg(loadApp({ seed: { rgxl_cfg: JSON.stringify(oldLowVision) } }));
  assert.equal(c.theme, 'mono-dark', 'theme unchanged by the update');
  assert.equal(c.preset, 'custom');
});

test('the High Contrast and Night swatches save each theme, and it survives a reload', () => {
  for (const theme of ['contrast-dark', 'contrast-light', 'contrast-auto', 'night']) {
    const w = loadApp();
    w.openSettings();
    const [family, mode] = theme === 'night' ? ['night', null] : ['contrast', theme.split('-')[1]];
    w.document.querySelector(`.theme-swatch[data-family="${family}"]`).click();
    if (mode) w.document.querySelector(`.theme-modes [data-mode="${mode}"]`).click();
    w.applySettings();
    assert.equal(savedCfg(w).theme, theme);
    const resolved = w.document.documentElement.className.match(/theme-(?!fading\b|snap\b)([\w-]+)/)[1];
    assert.ok(theme === 'night' ? resolved === 'night' : resolved.startsWith('contrast-') && resolved !== 'contrast-auto', `${theme} paints as ${resolved}`);
    assert.equal(savedCfg(loadApp({ seed: { rgxl_cfg: JSON.stringify(savedCfg(w)) } })).theme, theme, 'reloaded');
  }
});

test('applyPreset("Simplest") strips feedback down (minimal interaction)', () => {
  const w = loadApp();
  w.openSettings();
  w.applyPreset('Simplest');
  const c = savedCfg(w);
  assert.equal(c.preset, 'Simplest');
  assert.equal(c.advanced, 'off', 'simple transport only');
  assert.equal(c.haptics, 'off', 'no haptics');
  assert.equal(c.chime, 'off', 'no audio tones');
  assert.equal(c.size, 'xlarge');
});

test('applyPreset never touches streams / orgName / orientation / volume / pin', () => {
  const w = loadApp({ profile: 'example-org', seed: { rgxl_cfg: JSON.stringify({
    orientation: 'landscape-cw', volume: 42, orgName: 'My Room',
    streams: [{ id: 'a', label: 'Jazz', url: 'https://ice.example.com/jazz' }],
  }) } });
  w.openSettings();
  const beforePin = w.getPin();
  w.applyPreset('Low Vision');
  const c = savedCfg(w);
  assert.equal(c.orientation, 'landscape-cw', 'orientation untouched');
  assert.equal(c.volume, 42, 'volume untouched');
  assert.equal(c.orgName, 'My Room', 'orgName untouched');
  assert.deepEqual(c.streams, [{ id: 'a', label: 'Jazz', url: 'https://ice.example.com/jazz' }], 'streams untouched');
  assert.equal(w.getPin(), beforePin, 'PIN untouched');
});

test('applyPreset highlights exactly the active preset chip (aria-checked)', () => {
  const w = loadApp();
  w.openSettings();
  w.applyPreset('Simplest');
  const chips = [...w.document.querySelectorAll('.chip[data-group="preset"]')];
  const checked = chips.filter(c => c.getAttribute('aria-checked') === 'true').map(c => c.dataset.val);
  assert.deepEqual(checked, ['Simplest'], 'only the applied preset reads as selected');
});

test('fine-tuning a single control after a preset flips the highlight to custom', () => {
  // Presets are a starting point, not a lock: changing any preset-owned control
  // must mark the bundle as no longer matching → 'custom'.
  const w = loadApp();
  w.openSettings();
  w.applyPreset('Standard');
  assert.equal(w.matchingPresetName(), 'Standard', 'matches right after applying');

  // Diverge one field via the same chip path the UI uses.
  w.selectThemeMode('dark');   // Standard uses theme:auto
  assert.equal(w.matchingPresetName(), 'custom', 'manual edit no longer matches any preset');

  const c = savedCfg(w);
  assert.equal(c.preset, 'custom', 'persisted as custom');
  assert.equal(c.theme, 'dark', 'the fine-tuned value is what sticks');
});

test('applyPreset is a no-op on an unknown name (defensive)', () => {
  const w = loadApp();
  w.openSettings();
  const before = savedCfg(w);
  assert.doesNotThrow(() => w.applyPreset('Nonexistent'));
  const after = savedCfg(w);
  assert.equal(after.theme, before.theme, 'no fields changed for an unknown preset');
  assert.equal(after.preset, before.preset);
});

test('matchingPresetName recognizes a hand-built config that equals a preset bundle', () => {
  // A config whose preset-owned fields exactly equal Low Vision should be
  // recognized even if cfg.preset was stored as something stale.
  const w = loadApp({ seed: { rgxl_cfg: JSON.stringify({
    preset: 'custom',
    theme: 'contrast-dark', size: 'ultra', advanced: 'off',
    haptics: 'on', tts: 'on', chime: 'on', fillview: 'on',
  }) } });
  assert.equal(w.matchingPresetName(), 'Low Vision',
    'derived from the actual field values, not the stored label');
});

// ── Stream content note ──────────────────────────────────────────────────
test('the station section says stations are run by others and to listen before adding one', () => {
  const w = loadApp();
  const section = w.document.getElementById('stream-editor').closest('.s-group');
  const hint = [...section.querySelectorAll('.s-hint')].map((h) => h.textContent).join(' ');
  assert.match(hint, /run by other people/);
  assert.match(hint, /no control over what they play/);
  assert.match(hint, /Listen to a station yourself before adding it/);
});

test('Night turns the browser/status bar colour black, and leaving Night puts it back', () => {
  const w = loadApp({ seed: { rgxl_cfg: JSON.stringify({ theme: 'night' }) } });
  w.applyTheme();
  const meta = w.document.querySelector('meta[name="theme-color"]');
  assert.equal(meta.getAttribute('content'), '#000000');
  w.openSettings();
  w.document.querySelector('.theme-swatch[data-family="default"]').click();
  w.document.querySelector('.theme-modes [data-mode="dark"]').click();
  w.applySettings();
  assert.equal(meta.getAttribute('content'), '#0d0d1a');
});

test('every theme gives the browser/status bar its own header colour, so a light theme never sits under a black bar', () => {
  // Expected values come from the CSS source, not the code under test.
  const html = readFileSync(new URL('../RadioGridXL.html', import.meta.url), 'utf-8');
  const headerBg = (selector) => {
    const block = html.slice(html.indexOf(selector + ' {'));
    return block.slice(0, block.indexOf('}')).match(/--header-bg:\s*([^;]+);/)[1].trim();
  };
  const themes = { dark: ':root', light: 'html.theme-light', 'mono-dark': 'html.theme-mono-dark', 'mono-light': 'html.theme-mono-light',
    'contrast-dark': 'html.theme-contrast-dark', 'contrast-light': 'html.theme-contrast-light', night: 'html.theme-night' };
  const seen = new Set();
  for (const [theme, selector] of Object.entries(themes)) {
    const w = loadApp({ seed: { rgxl_cfg: JSON.stringify({ theme }) } });
    w.applyTheme();
    const content = w.document.querySelector('meta[name="theme-color"]').getAttribute('content');
    assert.equal(content, headerBg(selector), theme);
    seen.add(content);
  }
  assert.ok(seen.size >= 5, 'light and dark themes must not share one bar colour');
});

test('the 5+ station hint says icons show only on a small screen, not always — unhappy path', () => {
  const streams = Array.from({ length: 6 }, (_, i) => ({ id: 's' + (i + 1), label: 'Station ' + (i + 1), url: 'https://example.com/' + i }));
  const w = loadApp({ seed: { rgxl_cfg: JSON.stringify({ streams }) } });
  w.openSettings();
  const hint = w.document.getElementById('stream-hint');
  assert.equal(hint.style.display, 'block');
  assert.match(hint.textContent, /on a small screen buttons show only their icon/);
  assert.doesNotMatch(hint.textContent, /emoji only|switch to emoji/);
});

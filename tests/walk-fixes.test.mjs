/**
 * Fixes from the 11-05 simulator walk.
 * Each test names its finding (F1, F2 …) so the spec can point at it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadApp } from './harness.mjs';
import { installClock, bootPlayback, CONNECT_MS } from './playback-fakes.mjs';
import { readFileSync } from 'node:fs';

const HTML = readFileSync(new URL('../RadioGridXL.html', import.meta.url), 'utf-8');

const station = (id, url, label = 'Station ' + id) => ({ id, label, sub: '', url, emoji: '📻', color: 'blue' });
const boot = (streams) => loadApp({ seed: { rgxl_cfg: JSON.stringify({ streams }) } });
const urlInput = (w, i) => w.document.querySelector(`#stream-editor .s-input[data-field="url"][data-idx="${i}"]`);
const urlError = (w, i) => w.document.getElementById('url-err-' + i);
const saved = (w) => JSON.parse(w.localStorage.getItem('rgxl_cfg') || 'null');

// ── Setup can't hand the listener a broken radio ───────────────────────────

test('F2: Apply with a non-web address keeps settings open, names the problem and saves nothing — unhappy path', () => {
  const w = boot([station('a', 'https://radio.example/a'), station('b', 'https://radio.example/b')]);
  const before = w.localStorage.getItem('rgxl_cfg');
  for (const bad of ['javascript:alert(1)', 'ftp://radio.example/b', 'radio.example/b']) {
    w.openSettings();
    urlInput(w, 1).value = bad;
    w.applySettings();
    assert.equal(w.eval("settingsOpen"), true, `${bad}: settings stays open`);
    assert.equal(urlInput(w, 1).getAttribute('aria-invalid'), 'true', `${bad}: field marked`);
    assert.equal(urlError(w, 1).hidden, false, `${bad}: error shown under the field`);
    assert.match(urlError(w, 1).textContent, /Stream 2.*https:\/\//);
    assert.match(w.document.getElementById('apply-status').textContent, /Stream 2/);
    assert.equal(w.document.activeElement, urlInput(w, 1), `${bad}: focus moves to the field`);
    assert.equal(urlInput(w, 1).value, bad, `${bad}: not blanked`);
    assert.equal(w.localStorage.getItem('rgxl_cfg'), before, `${bad}: nothing saved`);
    w.doCloseSettings();
  }
  w.close();
});

test('F2: editing the address clears its error, and a fixed address applies', () => {
  const w = boot([station('a', 'https://radio.example/a')]);
  w.openSettings();
  urlInput(w, 0).value = 'ftp://x';
  w.applySettings();
  urlInput(w, 0).value = 'https://radio.example/fixed';
  w.updateUrlWarning(0);
  assert.equal(urlError(w, 0).hidden, true);
  assert.equal(urlInput(w, 0).hasAttribute('aria-invalid'), false);
  w.applySettings();
  assert.equal(w.eval("settingsOpen"), false);
  assert.equal(saved(w).streams[0].url, 'https://radio.example/fixed');
  w.close();
});

test('F3: a blank station from + Add Blank blocks Apply until it has an address — unhappy path', () => {
  const w = boot([station('a', 'https://radio.example/a')]);
  w.openSettings();
  w.addStreamEntry();
  w.applySettings();
  assert.equal(w.eval("settingsOpen"), true);
  assert.match(urlError(w, 1).textContent, /no web address/);
  assert.equal(saved(w).streams.length, 1, 'the blank station was not saved');
  w.close();
});

test('F3: a station saved with no address (an older version allowed it) never reaches the grid', () => {
  const w = boot([station('a', 'https://radio.example/a'), station('b', ''), station('c', 'https://radio.example/c')]);
  const ids = () => [...w.document.querySelectorAll('#buttons .stream-btn')].map((b) => b.id);
  w.renderButtons(); // lay out the seeded stations, as layout.test.mjs does
  assert.deepEqual(ids(), ['btn-a', 'btn-c']);
  w.openSettings();
  assert.deepEqual(ids().length, 2, 'settings opening alone does not re-render');
  w.renderButtons();
  assert.deepEqual(ids(), ['btn-a', 'btn-b', 'btn-c'], 'settings preview shows it, to set it up');
  w.doCloseSettings();
  assert.deepEqual(ids(), ['btn-a', 'btn-c'], 'gone again on close');
  w.close();
});

test('F13: applying a new address for a "Not available" station clears that state', () => {
  const w = boot([station('a', 'https://radio.example/a'), station('b', 'https://radio.example/b')]);
  w.eval("failedStreams").add('a');
  w.eval("failedStreams").add('b');
  w.openSettings();
  urlInput(w, 0).value = 'https://radio.example/a-new';
  w.applySettings();
  assert.equal(w.eval("failedStreams").has('a'), false, 'new address gets a fresh try');
  assert.equal(w.eval("failedStreams").has('b'), true, 'an unchanged station keeps its state');
  assert.doesNotMatch(w.document.getElementById('btn-a').getAttribute('aria-label'), /not available/);
  w.close();
});

test('F17: at 8 stations the add buttons stay, turned off, with the reason beside them', () => {
  const w = boot(Array.from({ length: 7 }, (_, i) => station('s' + i, 'https://radio.example/' + i)));
  w.openSettings();
  const row = w.document.getElementById('stream-add-row');
  const cap = w.document.getElementById('stream-cap');
  assert.ok([...row.querySelectorAll('button')].every((b) => !b.disabled), '7: add buttons on');
  assert.equal(cap.hidden, true);
  w.addStreamEntry();
  assert.notEqual(row.style.display, 'none', '8: row still shown');
  assert.ok([...row.querySelectorAll('button')].every((b) => b.disabled), '8: add buttons off');
  assert.equal(cap.hidden, false);
  assert.equal(cap.textContent, '8 of 8 stations. Remove one to add another.');
  w.addStreamEntry();
  assert.equal(w.eval("cfg").streams.length, 8, 'a 9th is still refused');
  w.close();
});

test('F5: settings always opens scrolled to the top', () => {
  const w = boot([station('a', 'https://radio.example/a')]);
  const panel = w.document.getElementById('settings-body');
  w.openSettings();
  panel.scrollTop = 900;
  w.doCloseSettings();
  w.openSettings();
  assert.equal(panel.scrollTop, 0);
  w.close();
});

// ── PIN ────────────────────────────────────────────────────────────────────

/** The PIN pad on a branded profile (the example-org fixture, PIN 2580), on a fake clock. */
function pinPad() {
  const w = loadApp({ profile: 'example-org' });
  const clock = installClock(w);
  w.showPinOverlay();
  const d = w.document;
  const enter = async (pin) => { for (const n of pin) w.pinKey(n); await clock.tick(200); };
  const error = () => d.getElementById('pin-error').textContent.trim();
  const wait = () => d.getElementById('pin-wait');
  const digits = () => [...d.querySelectorAll('#pin-pad .pin-key:not(.pin-key-wide)')];
  return { w, clock, enter, error, wait, digits };
}

test('F4: "Incorrect PIN" stays until the next key press — unhappy path', async () => {
  const p = pinPad();
  await p.enter('1111');
  assert.match(p.error(), /Incorrect PIN/);
  await p.clock.tick(5000);
  assert.match(p.error(), /Incorrect PIN/, 'still there 5 s later');
  p.w.pinKey('2');
  assert.equal(p.error(), '', 'the next key press clears it');
  await p.enter('580');
  assert.equal(p.w.eval('settingsOpen'), true, 'the right PIN after a wrong one opens settings');
  p.w.close();
});

test('F4: the lockout counts down each second with the digit keys off, then turns them back on — unhappy path', async () => {
  const p = pinPad();
  for (let i = 0; i < 5; i++) await p.enter('1111');
  assert.match(p.error(), /Too many attempts/);
  assert.equal(p.wait().hidden, false);
  assert.equal(p.wait().textContent, 'Try again in 25 s');
  assert.ok(p.digits().every((k) => k.disabled), 'digit keys off');
  assert.equal(p.w.document.querySelector('#pin-pad .pin-key-wide').disabled, false, 'Cancel stays on');
  assert.equal(p.wait().getAttribute('aria-live'), null, 'the countdown is not read out every second');
  await p.clock.tick(1000);
  assert.equal(p.wait().textContent, 'Try again in 24 s');
  await p.clock.tick(10000);
  assert.equal(p.wait().textContent, 'Try again in 14 s');
  p.w.pinKey('4');
  assert.equal(p.w.eval('pinEntry'), '', 'presses during the lockout do nothing');
  await p.clock.tick(14000);
  assert.equal(p.wait().hidden, true);
  assert.equal(p.error(), '');
  assert.ok(p.digits().every((k) => !k.disabled), 'digit keys back on');
  await p.enter('2580');
  assert.equal(p.w.eval('settingsOpen'), true);
  p.w.close();
});

test('F28: the settings PIN field opens masked, with a Show toggle', () => {
  const w = loadApp({ profile: 'example-org' });
  const d = w.document;
  const field = d.getElementById('in-pin');
  const show = d.getElementById('pin-show');
  w.openSettings();
  assert.ok(field.classList.contains('pin-masked'));
  assert.equal(field.getAttribute('inputmode'), 'numeric', 'keeps the number pad');
  assert.equal(field.type, 'text', 'not a password field, so no password manager');
  assert.equal(show.getAttribute('aria-pressed'), 'false');
  show.click();
  assert.ok(!field.classList.contains('pin-masked'));
  assert.equal(show.textContent, 'Hide');
  assert.equal(show.getAttribute('aria-pressed'), 'true');
  w.doCloseSettings();
  w.openSettings();
  assert.ok(field.classList.contains('pin-masked'), 'masked again next visit');
  w.close();
});

// ── Playing and controls ───────────────────────────────────────────────────

test('F8: Simple-mode Stop stops: the station goes idle, unpressed, and is forgotten for auto-resume', async () => {
  const t = bootPlayback({ cfg: { resume: 'on' } });
  t.w.playStream('s1');
  await t.clock.tick(CONNECT_MS);
  assert.equal(t.button('s1').getAttribute('aria-pressed'), 'true');
  assert.equal(t.w.localStorage.getItem('rgxl_last'), 's1');
  t.w.document.getElementById('simple-stop').click();
  assert.equal(t.w.eval('playing'), null, 'nothing loaded');
  assert.equal(t.button('s1').getAttribute('aria-pressed'), 'false');
  assert.doesNotMatch(t.label('s1'), /paused|\(on\)/, 'idle, not paused or playing');
  assert.equal(t.w.localStorage.getItem('rgxl_last'), null, 'auto-resume record cleared');
  assert.equal(t.w.document.getElementById('simple-stop-label').textContent, 'Stop');
  assert.equal(t.audio.state.paused, true, 'audio stopped');
  t.w.close();
});

test('F8: a station paused some other way still reads "Resume …" on the Simple bar, and the bar resumes it — unhappy path', async () => {
  const t = bootPlayback();
  t.w.playStream('s1');
  await t.clock.tick(CONNECT_MS);
  t.w.playStream('s1'); // a tap on the playing station pauses it
  assert.equal(t.button('s1').getAttribute('aria-pressed'), 'false', 'a paused station is not pressed');
  assert.match(t.w.document.getElementById('simple-stop-label').textContent, /Resume/);
  t.w.document.getElementById('simple-stop').click();
  await t.clock.tick(CONNECT_MS);
  assert.equal(t.w.eval('paused'), false, 'resumed');
  assert.equal(t.w.eval('playing'), 's1');
  t.w.close();
});

test('F12: auto-resume refused by the browser shows "Tap to resume" on the station, on screen', async () => {
  const t = bootPlayback();
  t.audio.blockAutoplay = true;
  t.w.playStream('s1');
  await t.clock.tick(CONNECT_MS);
  const status = t.button('s1').querySelector('.btn-status');
  assert.equal(status && status.textContent, 'Tap to resume');
  t.audio.blockAutoplay = false;
  t.w.playStream('s1');
  await t.clock.tick(CONNECT_MS);
  assert.equal(t.button('s1').querySelector('.btn-status'), null, 'gone once it plays');
  t.w.playStream('s1'); // the listener's own pause: no prompt line
  assert.equal(t.button('s1').querySelector('.btn-status'), null);
  t.w.close();
});

test('F9: LIVE hides while paused, and the Controls hint no longer promises skip on live radio', async () => {
  const t = bootPlayback({ cfg: { advanced: 'on' } });
  const live = t.w.document.getElementById('adv-live-badge');
  t.w.playStream('s1');
  await t.clock.tick(CONNECT_MS);
  assert.ok(live.classList.contains('visible'), 'LIVE while live audio plays');
  t.w.document.getElementById('adv-pause').click();
  assert.ok(!live.classList.contains('visible'), 'hidden while paused');
  t.w.document.getElementById('adv-pause').click();
  await t.clock.tick(CONNECT_MS);
  assert.ok(live.classList.contains('visible'), 'back on resume');
  t.w.openSettings();
  assert.match(t.w.document.getElementById('controls-hint').textContent, /Skip shows only for recordings, never live radio/);
  assert.doesNotMatch(HTML, /Advanced adds skip back\/forward/);
  t.w.close();
});

test('F10: Advanced Pause and Stop show their names; transport buttons are at least 44 px', async () => {
  const t = bootPlayback({ cfg: { advanced: 'on' } });
  t.w.playStream('s1');
  await t.clock.tick(CONNECT_MS);
  const d = t.w.document;
  assert.equal(d.querySelector('#adv-pause .adv-text').textContent, 'Pause');
  assert.equal(d.querySelector('.adv-stop .adv-text').textContent, 'Stop');
  d.getElementById('adv-pause').click();
  assert.equal(d.querySelector('#adv-pause .adv-text').textContent, 'Resume');
  for (const sel of ['.adv-btn', '.adv-sleep-btn', '.adv-stop', '.adv-pause']) {
    const rule = HTML.match(new RegExp('\\n' + sel.replace('.', '\\.') + ' \\{([^}]*)\\}'));
    assert.ok(rule, sel + ' rule');
    const h = Number((rule[1].match(/(?:min-height|height):\s*(\d+)px/) || [])[1]);
    const wd = Number((rule[1].match(/(?:min-width|width):\s*(\d+)px/) || [])[1]);
    assert.ok(h >= 44 && wd >= 44, `${sel}: ${wd} x ${h}`);
  }
  t.w.close();
});

test('F11: the sleep timer offers 15, 30, 60, 120 and 240 minutes, with Cancel only while one runs', () => {
  const t = bootPlayback({ cfg: { advanced: 'on' } });
  const d = t.w.document;
  const options = [...d.querySelectorAll('#sleep-overlay .sleep-options .sleep-opt')].map((b) => b.textContent);
  assert.deepEqual(options, ['15 min', '30 min', '1 hour', '2 hours', '4 hours']);
  const cancel = d.getElementById('sleep-cancel');
  t.w.showSleepOverlay();
  assert.equal(cancel.hidden, true, 'no timer: no Cancel');
  t.w.setSleep(60);
  assert.equal(t.w.eval('sleepRemaining'), 3600);
  t.w.showSleepOverlay();
  assert.equal(cancel.hidden, false, 'timer running: Cancel shown');
  cancel.click();
  assert.equal(t.w.eval('sleepRemaining'), 0);
  t.w.close();
});

test('F7: in MonoRadio and Night the playing station wears a ring at least 5 px thick, edge included', () => {
  for (const sel of ['html\\[class\\*="theme-mono"\\] \\.stream-btn\\.active', 'html\\.theme-night \\.stream-btn\\.active']) {
    const rule = HTML.match(new RegExp(sel + ' \\{([^}]*)\\}'));
    assert.ok(rule, sel);
    assert.match(rule[1], /border-color: var\(--accent\)/);
    assert.ok(Number(rule[1].match(/inset 0 0 0 (\d+)px var\(--accent\)/)[1]) >= 5, sel);
  }
});

// ── Settings polish ────────────────────────────────────────────────────────

test('F6: changing a preset setting by hand shows a chosen "Custom" chip; picking a preset hides it', () => {
  const w = loadApp();
  w.openSettings();
  const custom = w.document.querySelector('.chip[data-group="preset"][data-val="custom"]');
  assert.equal(custom.disabled, true, 'on Standard: Custom is off');
  w.eval("cfg").size = 'ultra';
  w.syncChips();
  assert.equal(custom.disabled, false);
  assert.equal(custom.getAttribute('aria-checked'), 'true');
  assert.ok(custom.classList.contains('selected'));
  w.applyPreset('Standard');
  assert.equal(custom.disabled, true);
  w.close();
});

test('F22: focusing the organization name puts the caret at the end', async () => {
  const w = loadApp();
  w.openSettings();
  await new Promise((r) => w.requestAnimationFrame(r)); // settings moves focus to Close first
  const field = w.document.getElementById('in-org-name');
  field.value = 'Example Center';
  field.setSelectionRange(0, 0);
  field.focus();
  field.dispatchEvent(new w.FocusEvent('focus'));
  await new Promise((r) => w.requestAnimationFrame(r));
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(field.selectionStart, field.value.length);
  w.close();
});

test('F25: Remove offers Undo, which puts the station back where it was', () => {
  const w = boot([station('a', 'https://radio.example/a'), station('b', 'https://radio.example/b'), station('c', 'https://radio.example/c')]);
  w.openSettings();
  const bar = w.document.getElementById('stream-undo');
  w.removeStreamEntry(1);
  assert.deepEqual([...w.eval('cfg').streams].map((s) => s.id), ['a', 'c']);
  assert.equal(bar.hidden, false);
  assert.match(w.document.getElementById('stream-undo-text').textContent, /Removed Station b/);
  assert.equal(w.document.activeElement.id, 'stream-undo-btn');
  w.document.getElementById('stream-undo-btn').click();
  assert.deepEqual([...w.eval('cfg').streams].map((s) => s.id), ['a', 'b', 'c']);
  assert.equal(bar.hidden, true);
  w.close();
});

test('F25: Undo ends after 8 s or at the next change to the list — unhappy path', () => {
  const w = boot([station('a', 'https://radio.example/a'), station('b', 'https://radio.example/b'), station('c', 'https://radio.example/c')]);
  const clock = installClock(w);
  w.openSettings();
  const bar = w.document.getElementById('stream-undo');
  w.removeStreamEntry(0);
  w.moveStream(0, 1);
  assert.equal(bar.hidden, true, 'a move ends it');
  w.removeStreamEntry(0);
  assert.equal(bar.hidden, false);
  return clock.tick(8000).then(() => {
    assert.equal(bar.hidden, true, 'gone after 8 s');
    w.undoRemoveStream();
    assert.equal(w.eval('cfg').streams.length, 1, 'nothing comes back once it has ended');
    w.close();
  });
});

test('F25: station names use the app font; addresses stay monospace; move and remove are 44 px', () => {
  assert.match(HTML, /\.s-input \{[^}]*font-family: inherit;/);
  assert.match(HTML, /\.s-input\[data-field="url"\] \{ font-family: monospace; \}/);
  const rule = HTML.match(/\n\.stream-action-btn \{([^}]*)\}/)[1];
  assert.match(rule, /min-height: 44px/);
  assert.match(rule, /flex: 1;/, 'full-width labelled buttons, far wider than 44 px');
});

test('F26: the Reset dialog, outside the app shell, uses the app font', () => {
  assert.match(HTML, /#reset-overlay \{ font-family: -apple-system/);
  assert.match(HTML.match(/\n\.reset-confirm-btn \{([^}]*)\}/)[1], /font-family: inherit/);
});

test('F27: Export says the backup is ready to save, not that it was exported', () => {
  const w = loadApp();
  w.URL.createObjectURL = () => 'blob:x';
  w.URL.revokeObjectURL = () => {};
  w.openSettings();
  w.exportConfig();
  assert.equal(w.document.getElementById('backup-status').textContent, 'Backup ready to save.');
  w.close();
});

test('F18: the voice hint names a place that exists on each platform', () => {
  const ios = loadApp({ beforeParse: (win) => Object.defineProperty(win.navigator, 'userAgent', { value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1' }) });
  assert.match(ios.document.getElementById('voice-hint').textContent, /Settings app: Accessibility → Spoken Content/);
  assert.doesNotMatch(ios.document.getElementById('voice-hint').textContent, /OS Settings below/);
  ios.close();
  const android = loadApp(); // the harness's default: Android, in a browser (no APK bridge)
  assert.match(android.document.getElementById('voice-hint').textContent, /Settings app and search for Text-to-speech/);
  android.close();
  const apk = loadApp({ beforeParse: (win) => { win.AndroidBridge = {}; } });
  assert.match(apk.document.getElementById('voice-hint').textContent, /OS Settings below/);
  apk.close();
});

test('F29: while settings is open the page behind is inert, and a dialog over it nests', () => {
  const w = loadApp();
  const d = w.document;
  const buttons = d.getElementById('buttons');
  const inertUp = (el) => { for (let e = el; e; e = e.parentElement) if (e.hasAttribute('inert')) return true; return false; };
  const panel = d.getElementById('settings-panel');
  const discard = d.getElementById('discard-overlay');
  const reset = d.getElementById('reset-overlay');
  w.openSettings();
  assert.ok(inertUp(buttons), 'the grid is inert behind settings');
  assert.ok(!inertUp(panel), 'settings itself is not');
  assert.ok(inertUp(reset), 'the dialog outside the app shell sees settings as on top too');
  w.showOverlay(discard);
  assert.ok(!inertUp(discard), 'the discard prompt over settings is live');
  assert.ok(inertUp(panel), 'settings is inert behind it');
  w.hideOverlay(discard);
  assert.ok(!inertUp(panel), 'settings live again');
  assert.ok(inertUp(discard) && inertUp(buttons), 'and the rest stays inert while settings is open');
  w.startPreview();
  assert.ok(!inertUp(buttons), 'preview: the grid can be read');
  w.endPreview();
  assert.ok(inertUp(buttons));
  w.doCloseSettings();
  // Closed stations' fields stay inert inside settings; nothing else does.
  assert.equal(d.querySelectorAll('[inert]:not(.stream-body)').length, 0, 'nothing left inert once closed');
  w.close();
});

test('F30: discarding a previewed theme switches back with no fade', () => {
  const w = loadApp();
  w.openSettings();
  w.eval('cfg').theme = 'light';
  w.applyTheme();
  w.doCloseSettings();
  assert.ok(w.document.documentElement.classList.contains('theme-snap'), 'fade off for the switch back');
  assert.ok(w.document.documentElement.classList.contains('theme-dark'));
  assert.match(HTML, /html\.theme-snap #app[^{]*\{ transition: none !important; \}/);
  w.close();
});

// ── Stream browser ─────────────────────────────────────────────────────────

function browser(streams) {
  const w = streams ? boot(streams) : loadApp();
  w.HTMLMediaElement.prototype.play = () => Promise.resolve();
  w.HTMLMediaElement.prototype.pause = () => {};
  w.openSettings();
  w.openStreamBrowser();
  return w;
}
const STUFFED = 'Smooth Jazz Lounge Chill Relax Café Jazz Bossa Nova Piano Bar Cocktail Dinner Jazz Saxophone Smooth Hits Radio Online 24/7';

test('F14: keyword-stuffed names rank below plain ones and show cut to 60 characters, full name in the label', () => {
  const w = browser();
  w.renderBrowserResults([
    { name: STUFFED, url_resolved: 'https://stuffed.example/s', clickcount: 9999 },
    { name: 'Jazz24', url_resolved: 'https://jazz24.example/s', clickcount: 10 },
  ]);
  const rows = [...w.document.querySelectorAll('.sb-result')];
  assert.equal(rows[0].querySelector('.sb-result-name').textContent, 'Jazz24', 'the plain name comes first');
  const shown = rows[1].querySelector('.sb-result-name').textContent;
  assert.ok(Array.from(shown).length <= 60, `shown: ${shown.length} characters`);
  assert.ok(shown.endsWith('…'));
  assert.equal(rows[1].querySelector('.sb-result-add').getAttribute('aria-label'), 'Add ' + STUFFED);
  w.close();
});

test('F15: the region list drops repeats that differ only in case, spacing or accents', () => {
  const w = loadApp();
  const names = w.regionNames([
    { country: 'France', name: 'Île-de-France', stationcount: 50 },
    { country: 'France', name: 'Ile-de-France', stationcount: 40 },
    { country: 'France', name: 'ile-de-france ', stationcount: 30 },
    { country: 'France', name: 'Bretagne', stationcount: 20 },
    { country: 'France', name: 'Bretagne  ', stationcount: 20 },
  ], 'France');
  assert.deepEqual([...names], ['Bretagne', 'Île-de-France']);
  w.close();
});

test('F15: after a search, changing the country or region searches again; before one, it does not — unhappy path', async () => {
  const w = browser();
  w.eval('searchStations = function() { sbSearched = true; window.__searches = (window.__searches || 0) + 1; }');
  w.document.getElementById('sb-country').value = '';
  w.sbFilterChanged();
  assert.equal(w.__searches, undefined, 'no search yet: nothing reruns');
  w.eval('searchStations()');
  w.sbFilterChanged();
  assert.equal(w.__searches, 2, 'a filter change after a search reruns it');
  w.showShelves();
  w.sbFilterChanged();
  assert.equal(w.__searches, 2, 'back on the shelves: no rerun');
  assert.equal(w.document.getElementById('sb-region').getAttribute('onchange'), 'sbFilterChanged()');
  assert.equal(w.document.getElementById('sb-country').getAttribute('onchange'), 'sbCountryChanged()');
  w.close();
});

test('F16: + Add keeps Browse open, marks the row Added and moves focus there', () => {
  const w = browser();
  w.renderBrowserResults([
    { name: 'One FM', url_resolved: 'https://one.example/s' },
    { name: 'Two FM', url_resolved: 'https://two.example/s' },
  ]);
  const before = w.eval('cfg').streams.length;
  w.document.querySelector('.sb-result .sb-result-add').click();
  assert.ok(w.document.getElementById('stream-browser-overlay').classList.contains('open'), 'still open');
  assert.equal(w.eval('cfg').streams.length, before + 1);
  const first = w.document.querySelector('.sb-result');
  assert.equal(first.querySelector('.sb-result-add'), null);
  assert.equal(w.document.activeElement, first.querySelector('.sb-result-added'));
  assert.match(w.document.getElementById('sb-status').textContent, /^Added One FM\. \d of 8 stations\.$/);
  w.document.querySelector('.sb-result-add').click();
  assert.equal(w.eval('cfg').streams.length, before + 2, 'a second add in the same visit');
  w.close();
});

test('F16: reaching 8 stations from Browse turns the other + Add buttons off and says why — unhappy path', () => {
  const w = browser(Array.from({ length: 7 }, (_, i) => station('s' + i, 'https://radio.example/' + i)));
  w.renderBrowserResults([
    { name: 'One FM', url_resolved: 'https://one.example/s' },
    { name: 'Two FM', url_resolved: 'https://two.example/s' },
  ]);
  const cap = w.document.getElementById('sb-cap');
  assert.equal(cap.hidden, true);
  w.document.querySelector('.sb-result-add').click();
  assert.equal(cap.hidden, false);
  assert.equal(cap.textContent, '8 of 8 stations. Remove one to add another.');
  assert.ok([...w.document.querySelectorAll('.sb-result-add')].every((b) => b.disabled));
  w.addFromBrowser(1);
  assert.equal(w.eval('cfg').streams.length, 8, 'no 9th');
  w.close();
});

test('F16: + Add and preview are at least 44 px', () => {
  assert.match(HTML.match(/\n\.sb-result-add \{([^}]*)\}/)[1], /min-height: 44px/);
  const play = HTML.match(/\n\.sb-result-play \{([^}]*)\}/)[1];
  assert.match(play, /width: 44px/);
  assert.match(play, /height: 44px/);
});

test('F24: emoji picker tabs wrap instead of running off the edge', () => {
  const rule = HTML.match(/\n\.emoji-picker-tabs \{([^}]*)\}/)[1];
  assert.match(rule, /flex-wrap: wrap/);
  assert.doesNotMatch(rule, /overflow-x/);
});

test('F1: a station added from Browse gets an icon no station has yet, where its genre has a look-alike', () => {
  const w = browser([station('a', 'https://radio.example/a')]);
  const jazz = (n) => ({ name: 'Jazz ' + n, url_resolved: `https://jazz${n}.example/s`, tags: 'jazz' });
  w.renderBrowserResults([jazz(1), jazz(2), jazz(3)]);
  for (let i = 0; i < 3; i++) w.addFromBrowser(i);
  assert.deepEqual([...w.eval('cfg').streams].slice(1).map((s) => s.emoji), ['🎷', '🎺', '🎹']);
  assert.equal(w.distinctIcon('🦄', [{ emoji: '🦄' }]), '🦄', 'no look-alike: keeps its own — unhappy path');
  w.close();
});

// ── Layout ─────────────────────────────────────────────────────────────────

/** Lay out n stations at a text size on a width x height screen; the title px. */
function titlePx(w, width, height, size, n) {
  const d = w.document;
  const header = d.getElementById('header');
  Object.defineProperty(w, 'innerWidth', { configurable: true, value: width });
  Object.defineProperty(w, 'innerHeight', { configurable: true, value: height });
  Object.defineProperty(d.getElementById('app'), 'clientHeight', { configurable: true, get: () => height });
  Object.defineProperty(header, 'offsetHeight', { configurable: true, get: () => (header.classList.contains('compact') ? 41 : 71) });
  Object.defineProperty(d.getElementById('simple-stop'), 'offsetHeight', { configurable: true, value: 74 });
  Object.defineProperty(d.getElementById('buttons'), 'clientWidth', { configurable: true, get: () => width });
  const names = ['SomaFM Groove Salad', 'SomaFM Drone Zone', 'World News Radio', 'Groove Salad Radio', 'Classical MPR', 'The Current', 'KUMD Duluth', 'BBC World Service'];
  const streams = names.slice(0, n).map((label, i) => ({ ...station('s' + i, 'https://radio.example/' + i, label), sub: 'Ambient and downtempo' }));
  w.localStorage.setItem('rgxl_cfg', JSON.stringify({ size, streams }));
  w.loadSettings();
  w.applyTheme();
  return parseFloat(d.getElementById('buttons').style.getPropertyValue('--btn-label-size'));
}

test('F20: on a 13-inch iPad every text size grows with the screen, and 8 stations never get bigger names than 2', () => {
  const w = loadApp();
  for (const [width, height] of [[1032, 1376], [1376, 1032]]) {
    let previous = 0;
    for (const size of ['normal', 'large', 'xlarge', 'ultra']) {
      const two = titlePx(w, width, height, size, 2);
      const eight = titlePx(w, width, height, size, 8);
      const base = { normal: 34, large: 40, xlarge: 52, ultra: 64 }[size];
      assert.ok(two > base, `${width}x${height} ${size}: 2 stations ${two} px, above the phone's ${base}`);
      assert.ok(eight <= two, `${width}x${height} ${size}: 8 stations ${eight} px vs 2 at ${two}`);
      assert.ok(two > previous, `${width}x${height}: ${size} larger than the size below`);
      previous = two;
    }
  }
  w.close();
});

test('F20: a phone keeps the base sizes — unhappy path for the screen growth', () => {
  const w = loadApp();
  assert.equal(titlePx(w, 402, 874, 'normal', 1), 34);
  w.close();
});

test('F23: Ultra comes out larger than X-Large at 2 stations on an iPhone, and the hint says why they can be close', () => {
  const w = loadApp();
  assert.ok(titlePx(w, 402, 874, 'ultra', 2) > titlePx(w, 402, 874, 'xlarge', 2));
  assert.match(HTML, /On a phone with few stations, X-Large and Ultra can look alike/);
  w.close();
});

test('F19: a new forced orientation waits until settings closes; the saved one holds meanwhile', () => {
  const w = loadApp();
  const root = w.document.documentElement;
  w.openSettings();
  w.selectChip(w.document.querySelector('.chip[data-group="orientation"][data-val="landscape-cw"]'), 'orientation', 'landscape-cw');
  assert.ok(!root.classList.contains('force-landscape-cw'), 'not while settings is open');
  w.applySettings();
  assert.ok(root.classList.contains('force-landscape-cw'), 'on close');
  w.openSettings();
  assert.ok(root.classList.contains('force-landscape-cw'), 'a sideways kiosk stays sideways when settings opens');
  w.selectChip(w.document.querySelector('.chip[data-group="orientation"][data-val="auto"]'), 'orientation', 'auto');
  assert.ok(root.classList.contains('force-landscape-cw'), 'the change back also waits');
  w.doCloseSettings(); // discard
  assert.ok(root.classList.contains('force-landscape-cw'), 'discarded: still the saved one');
  assert.match(HTML, /width: 100dvh;/);
  w.close();
});

// ── OS settings (F31) ──────────────────────────────────────────────────────

/** Answer media queries as a phone with these settings would. */
function phoneSettings(w, { light = false, moreContrast = false } = {}) {
  const real = w.matchMedia;
  w.matchMedia = (q) => ({
    ...real(q),
    matches: /prefers-contrast:\s*more/.test(q) ? moreContrast : /prefers-color-scheme:\s*light/.test(q) ? light : false,
  });
}

test('F31: an Auto theme shows High Contrast when the phone asks for more contrast, dark or light by its appearance', () => {
  for (const theme of ['auto', 'mono-auto', 'contrast-auto']) {
    for (const light of [false, true]) {
      const w = loadApp({ seed: { rgxl_cfg: JSON.stringify({ theme }) } });
      phoneSettings(w, { light, moreContrast: true });
      w.applyTheme();
      const want = 'theme-contrast-' + (light ? 'light' : 'dark');
      assert.ok(w.document.documentElement.classList.contains(want), `${theme}, ${light ? 'light' : 'dark'}: ${w.document.documentElement.className}`);
      assert.equal(w.eval('cfg').theme, theme, 'the saved choice is still Auto');
      w.close();
    }
  }
});

test('F31: a theme picked by hand ignores the contrast setting, and Auto without it is unchanged — unhappy path', () => {
  const w = loadApp({ seed: { rgxl_cfg: JSON.stringify({ theme: 'night' }) } });
  phoneSettings(w, { moreContrast: true });
  w.applyTheme();
  assert.ok(w.document.documentElement.classList.contains('theme-night'));
  w.close();
  const a = loadApp({ seed: { rgxl_cfg: JSON.stringify({ theme: 'mono-auto' }) } });
  phoneSettings(a, { moreContrast: false });
  a.applyTheme();
  assert.ok(a.document.documentElement.classList.contains('theme-mono-dark'));
  a.close();
});

/** Make the -apple-system-body probe read `px`, as Safari would. */
function phoneTextPx(w, px) {
  const real = w.getComputedStyle.bind(w);
  w.getComputedStyle = (el) => (el.textContent === 'A' && el.style.visibility === 'hidden' ? { fontSize: px + 'px' } : real(el));
}

test('F31: a fresh install on a phone set to an accessibility text size starts at X-Large', () => {
  const w = loadApp();
  phoneTextPx(w, 33);
  w.localStorage.removeItem('rgxl_cfg');
  w.loadSettings();
  assert.equal(w.eval('cfg').size, 'xlarge');
  w.close();
  const usual = loadApp();
  phoneTextPx(usual, 17);
  usual.localStorage.removeItem('rgxl_cfg');
  usual.loadSettings();
  assert.equal(usual.eval('cfg').size, 'large', "the phone's default text: the usual Large");
  usual.close();
});

test('F31: a saved text size is never changed by the phone setting — unhappy path', () => {
  const w = loadApp({ seed: { rgxl_cfg: JSON.stringify({ size: 'normal' }) } });
  phoneTextPx(w, 53);
  w.loadSettings();
  assert.equal(w.eval('cfg').size, 'normal');
  w.close();
});

// ── Found on the re-walk ───────────────────────────────────────────────────

test('re-walk: LIVE sits on the left of the Advanced bar, clear of the sleep timer button', () => {
  const w = loadApp();
  const live = w.document.getElementById('adv-live-badge');
  assert.equal(live.parentElement.id, 'adv-left');
  assert.equal(w.document.getElementById('adv-right').querySelector('#adv-live-badge'), null);
  w.close();
});

test('re-walk: Browse fits the visible height and scrolls whole on a short screen, so Close stays reachable', () => {
  const rule = HTML.match(/\n\.stream-browser \{([^}]*)\}/)[1];
  assert.match(rule, /max-height: min\(85dvh, 100%\)/);
  assert.match(rule, /overflow-y: auto/);
  assert.match(HTML, /@media \(max-height: 520px\) \{\n  \.stream-browser-results \{ flex: none; max-height: none;/);
  assert.match(HTML, /el\.classList\.contains\('stream-browser'\)/, 'touch scrolling allowed in the dialog');
});

test('re-walk: overlays blur the page behind them', () => {
  assert.match(HTML, /\.overlay \{ -webkit-backdrop-filter: blur\(12px\); backdrop-filter: blur\(12px\); \}/);
});

// ── Haptics: Android only ──────────────────────────────────────────────────

const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1';

test('haptics: the setting shows and vibrates on Android', () => {
  const w = loadApp(); // the harness's default device: an Android tablet
  assert.equal(w.document.getElementById('haptics-section').hidden, false);
  assert.equal(w.document.querySelector('.s-switch[data-switch="haptics"]').disabled, false);
  const buzzes = [];
  w.navigator.vibrate = (ms) => { buzzes.push(ms); return true; };
  w.doHaptic('s1');
  assert.deepEqual(buzzes, [30]);
  w.close();
});

test('haptics: greyed out with the reason on iPhone and desktop, and nothing vibrates there — unhappy path', () => {
  const cases = [
    [{ beforeParse: (win) => Object.defineProperty(win.navigator, 'userAgent', { value: IPHONE_UA }) }, /iPhone or iPad/],
    [{ desktop: true }, /this device/],
  ];
  for (const [opts, reason] of cases) {
    const w = loadApp(opts);
    assert.equal(w.document.getElementById('haptics-section').hidden, false);
    const sw = w.document.querySelector('.s-switch[data-switch="haptics"]');
    assert.equal(sw.disabled, true, 'switch disabled');
    assert.equal(sw.getAttribute('aria-checked'), 'false', 'never shown as on');
    assert.match(w.document.getElementById('haptics-hint').textContent, reason);
    const buzzes = [];
    w.navigator.vibrate = (ms) => { buzzes.push(ms); return true; };
    w.doHaptic('s1');
    assert.deepEqual(buzzes, []);
    w.close();
  }
});

/**
 * Screen-reader markup (VoiceOver, TalkBack), checked in jsdom.
 *
 * Live regions, on the fake clock (tests/playback-fakes.mjs): a live region
 * is read out whenever its text changes, over the radio. So the app may only
 * change one when the listener acted, and never when the sleep timer ends:
 * that would wake someone who has just fallen asleep. A focus move is read
 * out too, so the timer ending must not move focus either.
 *
 * Names: a control's name holds the words shown on it (label in name).
 *
 * Settings: the advice screen-reader users need there.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadApp } from './harness.mjs';
import { bootPlayback, STREAMS, CONNECT_MS } from './playback-fakes.mjs';

const [S1, S2] = STREAMS;

/** The live region a change at `node` belongs to, and how it is read: the
    nearest explicit aria-live wins, else the role's own (a timer is off). */
function liveRegion(node) {
  for (let el = node.nodeType === 1 ? node : node.parentElement; el; el = el.parentElement) {
    if (el.hasAttribute('aria-live')) return { el, live: el.getAttribute('aria-live') };
    const role = el.getAttribute('role');
    if (role === 'status' || role === 'log') return { el, live: 'polite' };
    if (role === 'alert') return { el, live: 'assertive' };
    if (role === 'timer' || role === 'marquee') return { el, live: 'off' };
  }
  return null;
}

const LIVE = '[aria-live], [role="status"], [role="log"], [role="alert"]';

/** What a screen reader has of `el`: nothing while it or an ancestor is
    hidden (jsdom applies the app's stylesheet, so a class counts), else its text. */
function exposedText(w, el) {
  for (let n = el; n; n = n.parentElement) {
    if (n.hidden || n.getAttribute('aria-hidden') === 'true') return '';
    const style = w.getComputedStyle(n);
    if (style.display === 'none' || style.visibility === 'hidden') return '';
  }
  return el.textContent.trim();
}

/** Record every change in what a live region exposes: its text, or the
    region being shown or hidden. Judged after each task, as a browser does,
    so a region switched off before its text changed is quiet. */
function recordLiveRegions(w) {
  const changes = [];
  const seen = new Map(); // region -> the text it last exposed
  const regions = () => w.document.querySelectorAll(LIVE);
  for (const el of regions()) seen.set(el, exposedText(w, el));
  const observer = new w.MutationObserver(() => {
    for (const el of regions()) {
      const text = exposedText(w, el);
      if (text !== (seen.get(el) || '') && liveRegion(el).live !== 'off') changes.push({ id: el.id, text });
      seen.set(el, text);
    }
  });
  observer.observe(w.document.body, { subtree: true, childList: true, characterData: true, attributes: true });
  return {
    changes,
    /** What would be read out. An emptied or hidden region says nothing:
        aria-relevant defaults to additions and text, not removals. */
    get spoken() { return changes.filter((c) => c.text).map((c) => c.text); },
  };
}

/** Every element that takes focus while `run` runs. */
async function focusMoves(w, run) {
  const moves = [];
  const onFocus = (e) => moves.push(e.target.id || e.target.className);
  w.document.addEventListener('focusin', onFocus);
  await run();
  w.document.removeEventListener('focusin', onFocus);
  return moves;
}

const sleepOption = (w, text) =>
  [...w.document.querySelectorAll('#sleep-overlay .sleep-opt')].find((b) => b.textContent === text);

/** Open the sleep overlay from the sleep button and tap one of its options,
    as the listener does. Closing the overlay hands focus back to that button. */
function tapSleep(w, text) {
  w.document.querySelector('.adv-sleep-btn').focus();
  w.showSleepOverlay();
  sleepOption(w, text).click();
}

/** Tap a station tile: a tap focuses the button it lands on. */
function tapStation(t, id) {
  t.button(id).focus();
  t.button(id).click();
}

// ── The countdown ──────────────────────────────────────────────────────────
test('the sleep countdown is not a live region, but says the time left when swiped to', async () => {
  const t = bootPlayback({ cfg: { advanced: 'on' } });
  const doc = t.w.document;
  const ind = doc.getElementById('sleep-indicator');
  assert.equal(ind.getAttribute('role'), 'timer');
  assert.equal(ind.hasAttribute('aria-live'), false, 'aria-live would override the timer role\'s "off"');
  assert.equal(liveRegion(ind.parentElement), null, 'and it sits in no live region');
  assert.equal(ind.hasAttribute('aria-label'), false, 'a label would be read as well as the text');
  assert.equal(doc.getElementById('sleep-countdown').getAttribute('aria-hidden'), 'true', 'the ticking seconds are not read');

  const left = doc.getElementById('sleep-left');
  assert.ok(ind.contains(left) && left.closest('[aria-hidden="true"]') === null,
    'the time left is text a swipe can land on (iOS VoiceOver may skip a timer with none)');
  const texts = [];
  new t.w.MutationObserver(() => texts.push(left.textContent))
    .observe(left, { childList: true, characterData: true, subtree: true });
  tapSleep(t.w, '30 min');
  await t.clock.tick(0);
  assert.equal(left.textContent, 'Sleep timer, 30 minutes left');
  await t.clock.tick(61000);
  assert.equal(left.textContent, 'Sleep timer, 29 minutes left');
  await t.clock.tick(59000);
  assert.deepEqual(texts.filter(Boolean),
    ['Sleep timer, 30 minutes left', 'Sleep timer, 29 minutes left', 'Sleep timer, 28 minutes left'],
    'the text changes once a minute, not every second');
});

test('a 2-hour sleep timer is said once when set, then stays quiet for the next 2 minutes', async () => {
  const t = bootPlayback({ cfg: { advanced: 'on' } });
  t.w.playStream('s1');
  await t.clock.tick(CONNECT_MS + 2000);
  const sr = recordLiveRegions(t.w);
  tapSleep(t.w, '2 hours');
  await t.clock.tick(120000);
  assert.deepEqual(sr.spoken, ['Sleep timer set for 2 hours.']);
  assert.equal(t.w.document.getElementById('sleep-left').textContent, 'Sleep timer, 1 hour 58 minutes left');
});

test('setting and cancelling the sleep timer are each confirmed once', async () => {
  const t = bootPlayback({ cfg: { advanced: 'on' } });
  t.w.playStream('s1');
  await t.clock.tick(CONNECT_MS + 2000);
  const sr = recordLiveRegions(t.w);
  tapSleep(t.w, '30 min');
  await t.clock.tick(10000);
  assert.deepEqual(sr.spoken, ['Sleep timer set for 30 minutes.']);
  tapSleep(t.w, 'Cancel Timer');
  await t.clock.tick(10000);
  assert.deepEqual(sr.spoken, ['Sleep timer set for 30 minutes.', 'Sleep timer off.']);
  assert.equal(t.w.document.getElementById('sleep-status').textContent, '',
    'cleared afterwards, so a later swipe finds no stale line');
});

test('the sleep timer ending says nothing to a screen reader either (unhappy path: someone asleep)', async () => {
  const t = bootPlayback({ cfg: { advanced: 'on', tts: 'on', chime: 'on' } });
  t.w.playStream('s1');
  await t.clock.tick(CONNECT_MS + 2000);
  tapSleep(t.w, '15 min');
  await t.clock.tick(15 * 60000 - 1000);
  const sr = recordLiveRegions(t.w);
  const before = { spoken: t.spoken.length, chimes: t.chime.chimes };
  await t.clock.tick(2000);
  assert.equal(t.label('s1'), S1.label, 'the timer stopped playback');
  assert.equal(t.conn(), 'Connection: idle', 'the dot changed, quietly');
  assert.deepEqual(sr.spoken, [], 'no live region spoke, not even "Connection: idle"');
  assert.deepEqual({ spoken: t.spoken.length, chimes: t.chime.chimes }, before, 'no voice, no chime');

  t.w.playStream('s1'); // the listener's next tap is heard again
  await t.clock.tick(CONNECT_MS);
  assert.ok(sr.spoken.includes('Connection: connected'), 'the connection status speaks again');
});

test('the sleep timer ending moves no focus from a station tile, playing or paused (unhappy path)', async () => {
  for (const pausedAtBedtime of [false, true]) {
    const t = bootPlayback({ cfg: { advanced: 'on' } });
    t.w.playStream('s2');
    await t.clock.tick(CONNECT_MS + 2000);
    tapSleep(t.w, '15 min');
    tapStation(t, 's1'); // then picks a station: focus is on its tile
    await t.clock.tick(CONNECT_MS + 2000);
    if (pausedAtBedtime) tapStation(t, 's1');
    assert.equal(t.w.document.activeElement.id, 'btn-s1');
    // The grid rebuild would focus the new tile, and a screen reader reads a
    // focus move out like a tap: "Radio Paradise Mellow Mix…" at bedtime.
    const moves = await focusMoves(t.w, () => t.clock.tick(15 * 60000));
    assert.equal(t.label('s1'), S1.label, 'the timer stopped playback');
    assert.deepEqual(moves, [], pausedAtBedtime ? 'paused' : 'playing');
  }
});

test('the sleep timer ending with the offline dialog up moves no focus (unhappy path)', async () => {
  const t = bootPlayback({ cfg: { advanced: 'on' } });
  t.w.playStream('s1');
  await t.clock.tick(CONNECT_MS + 2000);
  tapSleep(t.w, '15 min');
  t.setOnline(false);
  assert.ok(t.overlayShown());
  t.w.document.querySelector('#nonet-overlay button').focus(); // its requestAnimationFrame focus, by hand
  // Closing the dialog would hand focus back to the sleep button, out loud.
  const moves = await focusMoves(t.w, () => t.clock.tick(15 * 60000));
  assert.equal(t.overlayShown(), false, 'the timer stopped playback and closed the dialog');
  assert.deepEqual(moves, []);
});

test('the sleep status line is outside every dialog and starts empty', () => {
  const w = loadApp();
  const status = w.document.getElementById('sleep-status');
  assert.equal(status.closest('[role="dialog"], [role="alertdialog"]'), null,
    'a modal overlay hides the rest of the page from a screen reader');
  assert.equal(liveRegion(status).live, 'polite');
  assert.equal(status.textContent, '');
});

// ── Label in name (WCAG 2.5.3) ─────────────────────────────────────────────
// A voice-control user says what they see ("tap Export Backup"), which only
// works when the control's name holds those words. A station tile is labelled
// by its station name. Its second line describes the station, or says how it
// is doing, and the name need not repeat it: "Now playing: YourClassical
// Relax" still answers to "tap YourClassical Relax".

const CONTROLS = 'button, [role="button"], [role="radio"], [role="tab"], a[href]';

/** The words on screen inside `el`: every text node, sr-only text left out. */
function visibleText(el) {
  const out = [];
  const walk = (n) => {
    if (n.nodeType === 3) out.push(n.data);
    else if (n.nodeType === 1 && !n.classList.contains('sr-only')) n.childNodes.forEach(walk);
  };
  walk(el);
  return out.join(' ');
}

/** Lowercase, emoji, punctuation and symbols stripped, single spaces. */
const words = (s) => s.toLowerCase()
  .replace(/[\p{Extended_Pictographic}\p{P}\p{S}\u200d\ufe0f]/gu, '')
  .replace(/\s+/g, ' ').trim();

/** The words that label `el`: a station tile's name line, else all its text. */
const labelText = (el) =>
  visibleText(el.classList.contains('stream-btn') ? el.querySelector('.btn-label') || el : el);

/** Each labelled control whose name lacks the words that label it. */
function mismatches(w) {
  return [...w.document.querySelectorAll(CONTROLS)]
    .filter((el) => el.hasAttribute('aria-label'))
    .filter((el) => {
      const text = words(labelText(el));
      return text && !words(el.getAttribute('aria-label')).includes(text);
    })
    .map((el) => `"${labelText(el).trim()}" is named "${el.getAttribute('aria-label')}"`);
}

test('every labelled control with words on it has those words in its name (label in name)', async () => {
  // The bridge shows the Device buttons, as in the Android app.
  const t = bootPlayback({ cfg: { advanced: 'on' }, beforeParse: (win) => { win.AndroidBridge = {}; } });
  const found = {};
  t.w.openSettings(); // builds the stream editor and preset chips
  found.idle = mismatches(t.w);
  t.w.closeSettings();
  // Every state a station tile can be in, as renderButtons() names it.
  t.w.playStream('s1');
  await t.clock.tick(CONNECT_MS + 2000);
  assert.match(t.label('s1'), / \(on\)$/);
  found.playing = mismatches(t.w);
  t.w.playStream('s1');
  await t.clock.tick(100);
  assert.match(t.label('s1'), /, paused$/);
  found.paused = mismatches(t.w);
  t.w.playStream('s1');
  await t.clock.tick(CONNECT_MS + 2000);
  t.audio.drop();
  await t.clock.tick(10);
  assert.match(t.label('s1'), /, reconnecting/);
  found.reconnecting = mismatches(t.w);
  t.w.stopPlayback();
  t.audio.route(S2.url, 'dead');
  t.w.playStream('s2');
  await t.clock.tick(60000);
  assert.match(t.label('s2'), /not available/);
  found.failed = mismatches(t.w);
  assert.deepEqual(found, { idle: [], playing: [], paused: [], reconnecting: [], failed: [] });

  const exportBtn = [...t.w.document.querySelectorAll('#backup-section button')].find((b) => /Export/.test(b.textContent));
  assert.equal(exportBtn.getAttribute('aria-label'), 'Export Backup', 'named by its words, not its emoji');
});

// ── Presets ────────────────────────────────────────────────────────────────
test('the presets tell screen-reader users to turn Voice Announcements off (Low Vision turns them on)', () => {
  const w = loadApp();
  const hints = [...w.document.querySelectorAll('#preset-section .s-hint')].map((h) => h.textContent);
  assert.ok(hints.includes('Low Vision turns on Voice announcements. With VoiceOver or TalkBack, turn them off below.'),
    'the app speaking over VoiceOver or TalkBack makes both hard to follow');
  // And the hint stays true.
  w.openSettings();
  w.applyPreset('Low Vision');
  assert.equal(w.document.querySelector('.s-switch[data-switch="tts"]').getAttribute('aria-checked'), 'true');
});

// ── Station names ──────────────────────────────────────────────────────────
test('unhappy path: a station with no description has a name and no empty description; markup in a name is read as text', () => {
  const w = loadApp({ seed: { rgxl_cfg: JSON.stringify({ streams: [
    { id: 's1', label: 'Plain FM', url: 'https://ice.example.com/a' },
    { id: 's2', label: '<img src=x onerror="window.pwned=1">Odd FM', sub: 'News', url: 'https://ice.example.com/b' },
  ] }) } });
  w.renderButtons(); // the harness seeds storage after the first draw
  const plain = w.document.getElementById('btn-s1');
  assert.equal(plain.getAttribute('aria-label'), 'Plain FM');
  assert.equal(plain.hasAttribute('aria-describedby'), false, 'no description to point at');
  const odd = w.document.getElementById('btn-s2');
  assert.equal(odd.getAttribute('aria-label'), '<img src=x onerror="window.pwned=1">Odd FM', 'the name is the text as typed');
  assert.equal(odd.querySelector('img'), null, 'nothing built from it');
  assert.equal(w.document.getElementById(odd.getAttribute('aria-describedby')).textContent, 'News');
  assert.equal(w.pwned, undefined);
});

// ── Volume slider ──────────────────────────────────────────────────────────
// TalkBack read a fresh slider as "100.0, 100" (11-09), as the spoken value
// was only set while dragging.
test('the volume slider says its value as a percent when settings opens', () => {
  const w = loadApp();
  w.openSettings();
  const slider = w.document.getElementById('vol-slider');
  assert.equal(slider.getAttribute('aria-valuetext'), `${slider.value} percent`);
});

test('unhappy path: after Discard the volume slider says the restored value, not the dragged one', () => {
  const w = loadApp();
  w.openSettings();
  const slider = w.document.getElementById('vol-slider');
  const saved = slider.value;
  slider.value = '40';
  w.setVolume('40');
  w.closeSettings();
  w.confirmDiscard();
  w.openSettings();
  assert.equal(slider.value, saved);
  assert.equal(slider.getAttribute('aria-valuetext'), `${saved} percent`, 'a stale "40 percent" would be read out');
});

// ── Connection dot ─────────────────────────────────────────────────────────
// With an aria-label and the same words as hidden text, macOS VoiceOver read
// "Connection: idle empty application status" (11-07 and 11-09).
test('the connection status is its own text, beside a dot screen readers skip', () => {
  const w = loadApp();
  const dot = w.document.getElementById('conn-dot');
  const status = w.document.getElementById('conn-text');
  assert.equal(dot.getAttribute('aria-hidden'), 'true');
  assert.equal(dot.contains(status), false, 'text inside the 8px dot was never exposed by Safari');
  assert.equal(status.getAttribute('role'), 'status');
  assert.equal(status.hasAttribute('aria-label'), false, 'a label as well as text read as "empty"');
  assert.equal(status.textContent, 'Connection: idle');
  w.setConnStatus('good');
  assert.equal(status.textContent, 'Connection: connected');
  assert.equal(status.hasAttribute('aria-label'), false);
});

/**
 * Playback state machine, on a spec-shaped fake media element and a fake
 * clock (tests/playback-fakes.mjs). Covers what the listener hears and sees
 * across taps, pauses, failures, network loss and lock-screen controls.
 *
 * Standing rule these tests guard: nothing the app does on its own may start
 * audio the listener paused or stopped.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bootPlayback, STREAMS, CONNECT_MS, SLOW_CONNECT_MS } from './playback-fakes.mjs';

const [S1, S2] = STREAMS;

/** A station paused from outside (a call, the lock screen, a blocked
    autoplay) reads as off: its own name, not current, no ring, and "Tap to
    play" where its description goes. */
function assertTapToPlay(t, id) {
  const name = STREAMS.find(x => x.id === id).label;
  assert.equal(t.label(id), name, 'drawn off, not the current station');
  assert.equal(t.status(id), 'Tap to play');
  assert.equal(t.button(id).classList.contains('active'), false);
}

test('tap plays, a second tap keeps it playing, Stop clears everything', async () => {
  const t = bootPlayback();
  t.w.playStream('s1');
  await t.clock.tick(CONNECT_MS);
  assert.equal(t.audio.state.paused, false);
  assert.equal(t.label('s1'), S1.label + ' (on)');
  assert.equal(t.conn(), 'Connection: connected');

  const fetches = t.audio.fetches.length;
  t.w.playStream('s1');
  await t.clock.tick(CONNECT_MS);
  assert.equal(t.audio.state.paused, false, 'a tile only plays: the second tap never silences it');
  assert.equal(t.audio.fetches.length, fetches, 'and never reloads it');
  assert.equal(t.label('s1'), S1.label + ' (on)');

  t.w.stopPlayback();
  await t.clock.tick(CONNECT_MS);
  assert.equal(t.label('s1'), S1.label);
  assert.equal(t.conn(), 'Connection: idle');
});

test('switching stations loads the new one and leaves the old one idle', async () => {
  const t = bootPlayback();
  t.w.playStream('s1');
  await t.clock.tick(CONNECT_MS);
  t.w.playStream('s2');
  await t.clock.tick(CONNECT_MS);
  assert.equal(t.audio.state.src, S2.url);
  assert.equal(t.audio.state.paused, false);
  assert.equal(t.label('s2'), S2.label + ' (on)');
  assert.equal(t.label('s1'), S1.label);
});

test('a dead station is retried, then greyed out and stopped (unhappy path)', async () => {
  const t = bootPlayback();
  t.audio.route(S1.url, 'dead');
  t.w.playStream('s1');
  await t.clock.tick(CONNECT_MS);
  assert.equal(t.conn(), 'Connection: error');
  await t.clock.tick(3 * (4000 + CONNECT_MS));
  assert.match(t.label('s1'), /, not available$/);
  assert.ok(t.button('s1').classList.contains('failed'));
  assert.equal(t.audio.state.paused, true);
});

// ── Paused stays paused (network loss, retries) ───────────────────────────
async function playThenPause(t, how) {
  t.w.playStream('s1');
  await t.clock.tick(CONNECT_MS);
  if (how === 'lock screen') t.w.softStop(); else t.audio.externalPause();
  await t.clock.tick(0);
  assert.equal(t.audio.state.paused, true);
}

for (const how of ['call', 'lock screen']) {
  test(`paused with the ${how}: Wi-Fi dropping and coming back never restarts audio`, async () => {
    const t = bootPlayback();
    await playThenPause(t, how);
    const fetches = t.audio.fetches.length;
    t.setOnline(false);
    await t.clock.tick(0);
    assert.equal(t.overlayShown(), false, 'no "trouble connecting" dialog over a paused radio');
    t.setOnline(true);
    await t.clock.tick(10000);
    assert.equal(t.audio.state.paused, true);
    assert.equal(t.audio.fetches.length, fetches, 'nothing reloaded');
    assertTapToPlay(t, 's1');
  });
}

test('an error that arrives while paused does not schedule a restart', async () => {
  const t = bootPlayback();
  await playThenPause(t, 'lock screen');
  const fetches = t.audio.fetches.length;
  t.audio.drop();
  await t.clock.tick(10000);
  assert.equal(t.audio.state.paused, true);
  assert.equal(t.audio.fetches.length, fetches);
});

test('pausing while a retry is pending cancels the retry', async () => {
  const t = bootPlayback();
  t.w.playStream('s1');
  await t.clock.tick(CONNECT_MS);
  t.audio.drop();
  await t.clock.tick(1000); // error handled, retry due in 3 s
  t.w.softStop();
  const fetches = t.audio.fetches.length;
  await t.clock.tick(10000);
  assert.equal(t.audio.state.paused, true);
  assert.equal(t.audio.fetches.length, fetches);
});

// ── Paused stays paused through settings (Apply, a restored backup, Reset) ─
// Each rebuilds the grid and may change the paused station's own address.
const NEW_URL = 'https://ice.example.com/new-address';

test('paused, then Apply with the paused station\'s address edited: audio stays off', async () => {
  const t = bootPlayback();
  await playThenPause(t, 'call');
  const fetches = t.audio.fetches.length;
  t.w.openSettings();
  t.w.document.querySelector('#stream-editor .s-input[data-field="url"][data-idx="0"]').value = NEW_URL;
  t.w.applySettings();
  await t.clock.tick(10000);
  assert.equal(JSON.parse(t.w.localStorage.getItem('rgxl_cfg')).streams[0].url, NEW_URL, 'the edit was applied');
  assert.equal(t.audio.state.paused, true);
  assert.equal(t.audio.fetches.length, fetches, 'nothing loaded');
});

test('paused, then Apply with nothing changed: audio stays off', async () => {
  const t = bootPlayback();
  await playThenPause(t, 'lock screen');
  const fetches = t.audio.fetches.length;
  t.w.openSettings();
  t.w.applySettings();
  await t.clock.tick(10000);
  assert.equal(t.audio.state.paused, true);
  assert.equal(t.audio.fetches.length, fetches);
});

test('paused, then a backup restored that changes the paused station\'s address: audio stays off', async () => {
  const t = bootPlayback();
  await playThenPause(t, 'call');
  const fetches = t.audio.fetches.length;
  t.w.openSettings();
  const streams = STREAMS.map((s, i) => (i === 0 ? { ...s, url: NEW_URL } : s));
  assert.ok(t.w.applyImportedConfig(t.w.validateConfig({ v: 1, streams }), undefined));
  await t.clock.tick(10000);
  assert.equal(t.audio.state.paused, true);
  assert.equal(t.audio.fetches.length, fetches, 'nothing loaded');
});

test('paused, then Reset to Defaults: audio stays off', async () => {
  const t = bootPlayback({ cfg: { streams: STREAMS.map((s, i) => (i === 0 ? { ...s, url: NEW_URL } : s)) } });
  await playThenPause(t, 'lock screen');
  const fetches = t.audio.fetches.length;
  t.w.openSettings();
  t.w.confirmReset();
  t.w.executeReset();
  await t.clock.tick(10000);
  assert.equal(t.audio.state.paused, true);
  assert.equal(t.audio.fetches.length, fetches, 'nothing loaded');
});

test('Wi-Fi lost while playing shows the dialog and recovers once it returns', async () => {
  const t = bootPlayback();
  t.w.playStream('s1');
  await t.clock.tick(CONNECT_MS);
  t.setOnline(false);
  await t.clock.tick(0);
  assert.equal(t.overlayShown(), true);
  t.setOnline(true);
  await t.clock.tick(CONNECT_MS);
  assert.equal(t.overlayShown(), false);
  assert.equal(t.audio.state.paused, false);
  assert.equal(t.conn(), 'Connection: connected');
});

test('Wi-Fi back inside a pending retry window loads the stream once, not twice', async () => {
  const t = bootPlayback();
  t.w.playStream('s1');
  await t.clock.tick(CONNECT_MS);
  t.audio.drop();
  await t.clock.tick(0); // error while online: auto-retry scheduled for 4 s
  t.setOnline(false);
  t.setOnline(true); // retryStream() reloads now
  const fetches = t.audio.fetches.length;
  await t.clock.tick(5000);
  assert.equal(t.audio.fetches.length, fetches, 'the pending auto-retry was cancelled');
});

test('paused from the lock screen while the dialog is up: Wi-Fi back clears it and stays paused', async () => {
  const t = bootPlayback();
  t.w.playStream('s1');
  await t.clock.tick(CONNECT_MS);
  t.setOnline(false);
  await t.clock.tick(0);
  t.w.softStop(); // what the MediaSession 'pause' action runs
  await t.clock.tick(0);
  t.setOnline(true);
  await t.clock.tick(5000);
  assert.equal(t.overlayShown(), false);
  assert.equal(t.audio.state.paused, true);
});

// ── Recovering from a stream error ────────────────────────────────────────
test('tapping a station while it reconnects retries it now instead of pausing silence', async () => {
  const t = bootPlayback();
  t.w.playStream('s1');
  await t.clock.tick(CONNECT_MS);
  t.audio.drop();
  await t.clock.tick(0); // error: retry scheduled, the button still shows as playing
  const fetches = t.audio.fetches.length;
  t.w.playStream('s1');
  assert.ok(t.audio.fetches.length > fetches, 'the tap reloaded the stream');
  await t.clock.tick(CONNECT_MS);
  assert.equal(t.audio.state.paused, false);
  assert.equal(t.conn(), 'Connection: connected');
  assert.equal(t.label('s1'), S1.label + ' (on)');
});

const RESUME_PATHS = {
  'station tap': (t) => t.w.playStream('s1'),
  'stop bar': (t) => t.w.softStop(),
  'lock screen': (t) => t.handlers.play(),
};
for (const [path, resume] of Object.entries(RESUME_PATHS)) {
  test(`resuming with the ${path} after an error while paused reloads and plays`, async () => {
    const t = bootPlayback({ mediaSession: true });
    t.w.playStream('s1');
    await t.clock.tick(CONNECT_MS);
    t.w.softStop();
    t.audio.drop(); // the connection died while paused
    await t.clock.tick(0);
    resume(t);
    await t.clock.tick(CONNECT_MS);
    assert.equal(t.audio.state.paused, false);
    assert.equal(t.conn(), 'Connection: connected', 'not stuck on buffering');
  });
}

test('resuming a dead station restarts its retries instead of hanging (unhappy path)', async () => {
  const t = bootPlayback();
  t.audio.route(S1.url, 'dead');
  t.w.playStream('s1');
  await t.clock.tick(CONNECT_MS); // SRC_NOT_SUPPORTED: play() alone would reject from now on
  t.w.softStop();
  t.w.softStop();
  await t.clock.tick(CONNECT_MS);
  assert.equal(t.conn(), 'Connection: error', 'the reload failed and was reported');
  await t.clock.tick(3 * (4000 + CONNECT_MS));
  assert.ok(t.button('s1').classList.contains('failed'), 'retries ran out and the station greyed out');
});

test('resuming from the Stop bar while a retry is pending loads the stream once, not twice', async () => {
  const t = bootPlayback();
  t.w.playStream('s1');
  await t.clock.tick(CONNECT_MS);
  t.audio.drop();
  await t.clock.tick(1000); // error handled, retry due in 3 s
  t.w.softStop();
  await t.clock.tick(0);
  t.w.softStop(); // resume: reloads the faulted stream now
  const fetches = t.audio.fetches.length;
  await t.clock.tick(10000);
  assert.equal(t.audio.fetches.length, fetches, 'the old retry was cancelled');
  assert.equal(t.conn(), 'Connection: connected');
});

test('resuming during a pending retry, then pausing again: nothing restarts the audio', async () => {
  const t = bootPlayback();
  t.w.playStream('s1');
  await t.clock.tick(CONNECT_MS);
  t.audio.drop();
  await t.clock.tick(1000);
  t.w.softStop();
  t.w.softStop(); // resume
  await t.clock.tick(CONNECT_MS);
  t.w.softStop(); // paused again before the old retry was due
  const fetches = t.audio.fetches.length;
  await t.clock.tick(10000);
  assert.equal(t.audio.state.paused, true);
  assert.equal(t.audio.fetches.length, fetches);
});

test('resuming after three failed tries starts the count over, not giving up at the next error (unhappy path)', async () => {
  const t = bootPlayback();
  t.audio.route(S1.url, 'dead');
  t.w.playStream('s1');
  await t.clock.tick(CONNECT_MS + 2 * (4000 + CONNECT_MS)); // three failed tries
  t.w.softStop();
  t.w.softStop(); // resume: a fresh try
  await t.clock.tick(CONNECT_MS);
  assert.equal(t.button('s1').classList.contains('failed'), false, 'not greyed out after one more error');
  assert.equal(t.label('s1'), S1.label + ', reconnecting (on)');
  await t.clock.tick(3 * (4000 + CONNECT_MS));
  assert.ok(t.button('s1').classList.contains('failed'), 'four tries after the resume, then it gives up as usual');
});

test('blocked autoplay shows "tap to resume", not a playing screen with no sound', async () => {
  const t = bootPlayback();
  t.audio.blockAutoplay = true;
  t.w.playStream('s1');
  await t.clock.tick(CONNECT_MS);
  assertTapToPlay(t, 's1');
  assert.equal(t.conn(), 'Connection: idle');
  t.audio.blockAutoplay = false;
  t.w.playStream('s1');
  await t.clock.tick(CONNECT_MS);
  assert.equal(t.conn(), 'Connection: connected');
});

// ── Interruptions from outside the app (calls, other apps, headphones) ────
const ARM = {
  'switching stations': async (t) => {
    t.w.playStream('s1');
    await t.clock.tick(CONNECT_MS);
    t.w.playStream('s2');
  },
  'Stop, then playing again': async (t) => {
    t.w.playStream('s2');
    await t.clock.tick(CONNECT_MS);
    t.w.stopPlayback();
    t.w.playStream('s2');
  },
  'a dead station giving up': async (t) => {
    t.audio.route(S1.url, 'dead');
    t.w.playStream('s1');
    await t.clock.tick(4 * (4000 + CONNECT_MS));
    assert.ok(t.button('s1').classList.contains('failed'));
    t.w.playStream('s2');
  },
};
for (const [after, arm] of Object.entries(ARM)) {
  test(`after ${after}, an outside pause still shows as Paused`, async () => {
    const t = bootPlayback({ mediaSession: true });
    await arm(t);
    await t.clock.tick(CONNECT_MS);
    assert.equal(t.label('s2'), S2.label + ' (on)');
    t.audio.externalPause();
    await t.clock.tick(0);
    assertTapToPlay(t, 's2');
    assert.equal(t.w.navigator.mediaSession.playbackState, 'paused');
    assert.equal(t.conn(), 'Connection: idle');
  });
}

// ── Screen wake lock ──────────────────────────────────────────────────────
test('switching stations then Stop leaves no screen lock held', async () => {
  const t = bootPlayback();
  t.w.playStream('s1');
  await t.clock.tick(CONNECT_MS);
  t.w.playStream('s2');
  await t.clock.tick(CONNECT_MS);
  assert.equal(t.wake.held, 1, 'one lock while playing, not one per station');
  t.w.stopPlayback();
  await t.clock.tick(0);
  assert.equal(t.wake.held, 0);
});

test('the sleep timer ending after a station switch lets the screen sleep', async () => {
  const t = bootPlayback();
  t.w.playStream('s1');
  await t.clock.tick(CONNECT_MS);
  t.w.playStream('s2');
  t.w.setSleep(1);
  await t.clock.tick(61000);
  assert.equal(t.label('s2'), S2.label, 'the timer stopped playback');
  assert.equal(t.wake.held, 0);
});

test('pausing before the lock request resolves leaves no lock behind', async () => {
  const t = bootPlayback();
  t.w.playStream('s1');
  t.w.softStop(); // paused from the lock screen in the same moment
  await t.clock.tick(CONNECT_MS);
  assert.equal(t.wake.held, 0);
});

test('pause and resume cycles hold exactly one lock while playing', async () => {
  const t = bootPlayback();
  t.w.playStream('s1');
  for (let i = 0; i < 3; i++) {
    await t.clock.tick(CONNECT_MS);
    t.w.softStop();
    await t.clock.tick(0);
    assert.equal(t.wake.held, 0, 'released on pause');
    t.w.softStop();
  }
  await t.clock.tick(CONNECT_MS);
  assert.equal(t.wake.held, 1);
});

test('coming back to the app re-takes the lock only while playing, not while paused', async () => {
  const t = bootPlayback();
  const backToApp = async () => {
    t.wake.releaseAll(); // the browser drops screen locks when the page is hidden
    t.w.document.dispatchEvent(new t.w.Event('visibilitychange'));
    await t.clock.tick(0);
  };
  t.w.playStream('s1');
  await t.clock.tick(CONNECT_MS);
  await backToApp();
  assert.equal(t.wake.held, 1, 're-taken while playing');
  t.w.softStop();
  await backToApp();
  assert.equal(t.wake.held, 0, 'not taken while paused');
});

// ── Spoken feedback ───────────────────────────────────────────────────────
test('Stop within the speech delay: the stale "Now playing" is never said', async () => {
  const t = bootPlayback({ cfg: { tts: 'on' } });
  t.w.playStream('s1');
  await t.clock.tick(300);
  t.w.stopPlayback();
  await t.clock.tick(2000);
  assert.deepEqual(t.spoken, []);
});

test('an accidental double tap says "Now playing" once and nothing else', async () => {
  const t = bootPlayback({ cfg: { tts: 'on' } });
  t.w.playStream('s1');
  await t.clock.tick(300);
  const chimes = t.chime.chimes;
  t.w.playStream('s1');
  await t.clock.tick(2000);
  assert.deepEqual(t.spoken, ['Now playing ' + S1.label]);
  assert.equal(t.chime.chimes, chimes, 'no chime for the second tap');
});

test('switching quickly names only the station now playing', async () => {
  const t = bootPlayback({ cfg: { tts: 'on' } });
  t.w.playStream('s1');
  await t.clock.tick(300);
  t.w.playStream('s2');
  await t.clock.tick(2000);
  assert.deepEqual(t.spoken, ['Now playing ' + S2.label]);
});

// ── Lock-screen skip ──────────────────────────────────────────────────────
const SKIP_ACTIONS = ['previoustrack', 'nexttrack', 'seekbackward', 'seekforward'];

test('live radio offers no skip or seek on the lock screen; play, pause and stop stay', async () => {
  const t = bootPlayback({ mediaSession: true });
  t.w.playStream('s1');
  await t.clock.tick(CONNECT_MS);
  for (const action of SKIP_ACTIONS) assert.equal(t.handlers[action], undefined, `${action} hidden`);
  for (const action of ['play', 'pause', 'stop']) assert.equal(typeof t.handlers[action], 'function');
});

test('a stream with a length gets lock-screen skip, and loses it on switching to live radio', async () => {
  const t = bootPlayback({ mediaSession: true });
  t.audio.route(S1.url, 'vod');
  t.w.playStream('s1');
  await t.clock.tick(CONNECT_MS);
  for (const action of SKIP_ACTIONS) assert.equal(typeof t.handlers[action], 'function', `${action} offered`);
  t.handlers.nexttrack();
  assert.equal(t.audio.state.currentTime, 30, 'skips forward 30 s');
  t.w.playStream('s2');
  await t.clock.tick(CONNECT_MS);
  for (const action of SKIP_ACTIONS) assert.equal(t.handlers[action], undefined, `${action} hidden again`);
});

test('skip never seeks live radio, even when the engine reports a seekable range (unhappy path)', async () => {
  const t = bootPlayback();
  t.audio.liveSeekable = true;
  t.w.playStream('s1');
  await t.clock.tick(CONNECT_MS);
  t.audio.state.currentTime = 100;
  t.w.skipFwd();
  t.w.skipBack();
  assert.equal(t.audio.state.currentTime, 100);
});

// ── Focus and tap flash survive the grid rebuild ──────────────────────────
test('a focused station button keeps focus through a tap and announces its new state', async () => {
  const t = bootPlayback();
  t.button('s1').focus();
  t.button('s1').click();
  assert.equal(t.w.document.activeElement.id, 'btn-s1', 'focus is on the rebuilt button, not <body>');
  assert.equal(t.w.document.activeElement.getAttribute('aria-current'), 'true');
  await t.clock.tick(CONNECT_MS);
  t.audio.externalPause(); // a rebuild the listener didn't start
  await t.clock.tick(0);
  assert.equal(t.w.document.activeElement.id, 'btn-s1');
  assert.equal(t.w.document.activeElement.getAttribute('aria-label'), S1.label);
});

test('the tap flash shows on the rebuilt button', () => {
  const t = bootPlayback();
  t.button('s2').click();
  assert.ok(t.w.document.querySelector('#btn-s2 .tap-flash').classList.contains('flash'));
  assert.equal(t.w.document.querySelector('#btn-s1 .tap-flash').classList.contains('flash'), false);
});

test('a rebuild never pulls focus onto the grid from elsewhere (unhappy path)', async () => {
  const t = bootPlayback();
  t.w.playStream('s1');
  await t.clock.tick(CONNECT_MS);
  const stop = t.w.document.getElementById('simple-stop');
  stop.focus();
  t.audio.externalPause();
  await t.clock.tick(0);
  assert.equal(t.w.document.activeElement, stop);
});

// A tap flashes once: a flash that has ended must not come back with the next
// rebuild. jsdom runs no CSS animations and fires no animationend, the same as
// with reduced motion, so these also show the flash ends on its own clock.
const FLASH_MS = 250; // the tapFlash animation in the CSS
const flashing = (t) => Array.from(t.w.document.querySelectorAll('.tap-flash.flash'), (f) => f.parentElement.id);

test('tapping another station flashes only that one, not the one tapped before', async () => {
  const t = bootPlayback();
  t.button('s1').click();
  await t.clock.tick(CONNECT_MS + FLASH_MS);
  assert.deepEqual(flashing(t), [], 'the first flash is over');
  t.button('s2').click();
  assert.deepEqual(flashing(t), ['btn-s2']);
});

test('a rebuild during the flash keeps it, and the rebuilt button still ends it on time', async () => {
  const t = bootPlayback();
  t.button('s1').click();
  await t.clock.tick(100);
  t.w.renderButtons(); // say, the screen turning while the flash runs
  assert.deepEqual(flashing(t), ['btn-s1'], 'the running flash carried over');
  await t.clock.tick(FLASH_MS - 101);
  assert.deepEqual(flashing(t), ['btn-s1'], 'not cut short: still running just before 250 ms');
  await t.clock.tick(1);
  assert.deepEqual(flashing(t), [], 'gone from the new button too, 250 ms after the tap');
  t.w.renderButtons();
  assert.deepEqual(flashing(t), []);
});

test('a second tap inside the flash gets a whole flash of its own', async () => {
  const t = bootPlayback();
  t.button('s1').click();
  await t.clock.tick(200);
  t.button('s1').click(); // a second tap, before the first flash is over
  await t.clock.tick(100);
  assert.deepEqual(flashing(t), ['btn-s1'], "the first tap's timer doesn't cut the second flash short");
  await t.clock.tick(FLASH_MS - 100);
  assert.deepEqual(flashing(t), []);
});

test('a station id with a quote or a bracket still plays and flashes (unhappy path: a hand-edited backup)', async () => {
  // The flash looks its button up by id. Built into a '#btn-…' selector, an id
  // like this made querySelector throw inside playStream, so the station never played.
  const odd = { ...S1, id: 'a"b[' };
  const t = bootPlayback({ cfg: { streams: [odd, S2] } });
  t.w.renderButtons(); // the harness loads the seeded streams after the first draw
  t.button(odd.id).click();
  await t.clock.tick(CONNECT_MS);
  assert.equal(t.audio.state.src, odd.url);
  assert.equal(t.label(odd.id), odd.label + ' (on)');
  assert.deepEqual(flashing(t), ['btn-' + odd.id]);
  await t.clock.tick(FLASH_MS);
  assert.deepEqual(flashing(t), []);
});

test('a station that keeps reconnecting is not flashed again by each retry (unhappy path)', async () => {
  // The bedroom case: the stream drops at night with the screen kept on, and
  // the grid rebuilds on the error and again on every retry 4 s later.
  const t = bootPlayback();
  t.button('s1').click();
  await t.clock.tick(CONNECT_MS + FLASH_MS);
  t.audio.route(S1.url, 'dead');
  t.audio.drop();
  await t.clock.tick(0);
  assert.equal(t.label('s1'), S1.label + ', reconnecting (on)');
  assert.deepEqual(flashing(t), []);
  await t.clock.tick(2 * (4000 + CONNECT_MS));
  assert.equal(t.label('s1'), S1.label + ', reconnecting (on)', 'still retrying, two rebuilds later');
  assert.deepEqual(flashing(t), []);
});

test('the flash ending never restarts a paused radio, and a later rebuild stays dark', async () => {
  const t = bootPlayback();
  t.button('s1').click();
  await t.clock.tick(CONNECT_MS);
  t.button('s1').click(); // a second tap: flashes
  t.audio.externalPause(); // then a call
  await t.clock.tick(0);
  const fetches = t.audio.fetches.length;
  await t.clock.tick(FLASH_MS);
  t.w.dispatchEvent(new t.w.Event('resize')); // a rebuild nobody tapped for
  await t.clock.tick(100);
  assert.deepEqual(flashing(t), []);
  assert.equal(t.audio.state.paused, true);
  assert.equal(t.audio.fetches.length, fetches, 'nothing reloaded');
  assertTapToPlay(t, 's1');
});

// ── Saying what is happening: connecting, playing, not available ──────────
const GIVE_UP_MS = 4 * (4000 + CONNECT_MS);
const NOT_AVAILABLE = (label) => label + ' is not available right now. Try another station.';

test('a station that starts quickly is announced once, when its audio starts', async () => {
  const t = bootPlayback({ cfg: { tts: 'on' } });
  t.w.playStream('s1');
  await t.clock.tick(CONNECT_MS + 2000);
  assert.deepEqual(t.spoken, ['Now playing ' + S1.label]);
});

test('a slow start says "Connecting to" first, then "Now playing" once it plays', async () => {
  const t = bootPlayback({ cfg: { tts: 'on' } });
  t.audio.route(S1.url, 'slow');
  t.w.playStream('s1');
  await t.clock.tick(3500);
  assert.deepEqual(t.spoken, ['Connecting to ' + S1.label]);
  await t.clock.tick(SLOW_CONNECT_MS);
  assert.deepEqual(t.spoken, ['Connecting to ' + S1.label, 'Now playing ' + S1.label]);
});

test('a dead station is never announced as playing; its failure is said, shown and buzzed', async () => {
  const t = bootPlayback({ cfg: { tts: 'on' } });
  t.audio.route(S1.url, 'dead');
  t.w.playStream('s1');
  const buzzes = t.buzz.count;
  await t.clock.tick(GIVE_UP_MS + 1000);
  assert.deepEqual(t.spoken, ['Connecting to ' + S1.label, NOT_AVAILABLE(S1.label)]);
  assert.equal(t.conn(), NOT_AVAILABLE(S1.label), 'status region names the station');
  assert.equal(t.w.document.getElementById('conn-text').textContent, NOT_AVAILABLE(S1.label));
  assert.equal(t.label('s1'), S1.label + ', not available');
  assert.equal(t.button('s1').querySelector('.btn-status').textContent, 'Not available. Tap to try again.');
  assert.ok(t.buzz.count > buzzes, 'a buzz when it gives up');
});

test('while retrying, the station reads "Reconnecting…", and recovers to Now playing', async () => {
  const t = bootPlayback();
  t.w.playStream('s1');
  await t.clock.tick(CONNECT_MS);
  t.audio.drop();
  await t.clock.tick(0);
  assert.equal(t.label('s1'), S1.label + ', reconnecting (on)');
  assert.equal(t.button('s1').querySelector('.btn-status').textContent, 'Reconnecting…');
  await t.clock.tick(4000 + CONNECT_MS);
  assert.equal(t.label('s1'), S1.label + ' (on)');
  assert.equal(t.button('s1').querySelector('.btn-status'), null);
  assert.equal(t.button('s1').querySelector('.btn-sublabel').textContent, S1.sub);
});

test('the Stop button and the lock-screen Stop say "Stopped"', async () => {
  const t = bootPlayback({ cfg: { tts: 'on', advanced: 'on' }, mediaSession: true });
  t.w.playStream('s1');
  await t.clock.tick(CONNECT_MS + 2000);
  t.w.document.querySelector('.adv-stop').click();
  await t.clock.tick(2000);
  assert.equal(t.spoken.at(-1), 'Stopped');
  t.w.playStream('s2');
  await t.clock.tick(CONNECT_MS + 2000);
  t.handlers.stop();
  await t.clock.tick(2000);
  assert.equal(t.spoken.at(-1), 'Stopped');
});

test('the sleep timer ends without a chime, voice or buzz (unhappy path: someone asleep)', async () => {
  const t = bootPlayback({ cfg: { tts: 'on' } });
  t.w.playStream('s1');
  await t.clock.tick(CONNECT_MS + 2000);
  t.w.setSleep(1);
  const before = { spoken: t.spoken.length, chimes: t.chime.chimes, buzzes: t.buzz.count };
  await t.clock.tick(61000);
  assert.equal(t.label('s1'), S1.label, 'the timer stopped playback');
  assert.deepEqual({ spoken: t.spoken.length, chimes: t.chime.chimes, buzzes: t.buzz.count }, before);
});

// A station going down in the night: s1 has been playing for a while, then the
// stream drops and every retry fails until the app gives up. Returns what the
// listener got from the app while it gave up. The tap's own flash ended long
// before, so any flash seen is the failure's. A flash lasts 250 ms, so look
// every 100 ms rather than only at the end.
async function stationGoesDown(t) {
  t.audio.route(S1.url, 'dead');
  t.audio.drop();
  const spoken = t.spoken.length, chimes = t.chime.chimes, buzzes = t.buzz.count;
  let flash = false;
  for (let ms = 0; ms < GIVE_UP_MS + 1000; ms += 100) {
    await t.clock.tick(100);
    if (t.w.document.querySelector('.tap-flash.flash')) flash = true;
  }
  return {
    spoken: t.spoken.slice(spoken),
    chimes: t.chime.chimes - chimes,
    buzzes: t.buzz.count - buzzes,
    flash,
  };
}

test('a station giving up while the sleep timer runs is shown, with no chime, voice, buzz or flash (unhappy path: someone asleep)', async () => {
  const t = bootPlayback({ cfg: { tts: 'on' } });
  t.w.playStream('s1');
  await t.clock.tick(CONNECT_MS + 2000);
  t.w.setSleep(30);
  const got = await stationGoesDown(t);
  assert.deepEqual(got, { spoken: [], chimes: 0, buzzes: 0, flash: false });
  // Still there for anyone awake to read, or for their own screen reader.
  assert.ok(t.button('s1').classList.contains('failed'), 'the station is greyed out');
  assert.equal(t.label('s1'), S1.label + ', not available');
  assert.equal(t.conn(), NOT_AVAILABLE(S1.label));
  assert.equal(t.w.document.getElementById('conn-text').textContent, NOT_AVAILABLE(S1.label));
  // Stopped for the rest of the night: nothing reloads or plays later on.
  const fetches = t.audio.fetches.length;
  await t.clock.tick(31 * 60 * 1000);
  assert.equal(t.audio.state.paused, true);
  assert.equal(t.audio.fetches.length, fetches);
});

test('a station giving up with no sleep timer still chimes, says, buzzes and flashes it', async () => {
  const t = bootPlayback({ cfg: { tts: 'on' } });
  t.w.playStream('s1');
  await t.clock.tick(CONNECT_MS + 2000);
  const got = await stationGoesDown(t);
  assert.deepEqual(got, { spoken: [NOT_AVAILABLE(S1.label)], chimes: 1, buzzes: 1, flash: true });
  assert.ok(t.button('s1').classList.contains('failed'));
});

test("Chromium's own pause after a load failure doesn't stop the retries (regression)", async () => {
  // Real Chromium fires 'pause' right after 'error' for a dead URL. Read as an
  // outside pause, it flipped the station to "Paused" and the paused guard on
  // the retry timer then stopped the retries for good.
  const t = bootPlayback();
  t.audio.route(S1.url, 'dead');
  t.w.playStream('s1');
  await t.clock.tick(CONNECT_MS + 1);
  assert.notEqual(t.status('s1'), 'Tap to play');
  const fetches = t.audio.fetches.length;
  await t.clock.tick(4000 + CONNECT_MS);
  assert.ok(t.audio.fetches.length > fetches, 'the retry still ran');
});

test("Chromium's own pause after a mid-stream drop doesn't stop the retries either", async () => {
  // Chromium pauses the element on a mid-stream network error too, where
  // networkState is NETWORK_IDLE, so "the source never loaded" can't be what
  // tells its pause apart from the listener's.
  const t = bootPlayback();
  t.w.playStream('s1');
  await t.clock.tick(CONNECT_MS);
  t.audio.drop();
  await t.clock.tick(0);
  assert.equal(t.audio.state.paused, true, 'the element paused itself, as in Chromium');
  assert.equal(t.label('s1'), S1.label + ', reconnecting (on)');
  await t.clock.tick(4000 + CONNECT_MS);
  assert.equal(t.label('s1'), S1.label + ' (on)');
});

// Where the element keeps playing after an error (the spec, WebKit), a pause
// that arrives while the error stands is the listener's: a call, the lock
// screen. (In Chromium the element is already paused then, so none arrives.)
const FAILURES = {
  'the connection drops': async (t) => {
    t.w.playStream('s1');
    await t.clock.tick(CONNECT_MS);
    t.audio.drop();
    await t.clock.tick(0);
  },
  'a dead station': async (t) => {
    t.audio.route(S1.url, 'dead');
    t.w.playStream('s1');
    await t.clock.tick(CONNECT_MS);
  },
};
for (const [failure, fail] of Object.entries(FAILURES)) {
  test(`${failure}, then a call pauses it: the pending retry never restarts audio`, async () => {
    const t = bootPlayback();
    t.audio.pauseOnFailure = false;
    await fail(t);
    assert.equal(t.label('s1'), S1.label + ', reconnecting (on)', 'a retry is pending');
    t.audio.externalPause();
    await t.clock.tick(0);
    assertTapToPlay(t, 's1');
    const fetches = t.audio.fetches.length;
    await t.clock.tick(10000);
    assert.equal(t.audio.state.paused, true);
    assert.equal(t.audio.fetches.length, fetches, 'the retry did not reload');
  });
}

test('a call during the no-network dialog: Wi-Fi coming back leaves the radio paused', async () => {
  const t = bootPlayback();
  t.audio.pauseOnFailure = false;
  t.w.playStream('s1');
  await t.clock.tick(CONNECT_MS);
  t.setOnline(false);
  t.audio.drop(); // the stream dies with the Wi-Fi
  await t.clock.tick(0);
  assert.equal(t.overlayShown(), true);
  t.audio.externalPause();
  await t.clock.tick(0);
  const fetches = t.audio.fetches.length;
  t.setOnline(true);
  await t.clock.tick(10000);
  assert.equal(t.overlayShown(), false);
  assert.equal(t.audio.state.paused, true);
  assert.equal(t.audio.fetches.length, fetches, 'nothing reloaded');
  assertTapToPlay(t, 's1');
});

// ── Auto-resume: only a radio that was playing when the app closed ────────
/** Open the app again on this one's storage, as after a reboot or the browser
    dropping the tab. The boot auto-resume runs before bootPlayback installs
    its fakes, on jsdom's own element, so judge it by the station button and
    by the src the app gave that element. `blockAutoplay` makes play() reject
    as it does without a tap. */
function relaunch(t, { blockAutoplay = false } = {}) {
  const saved = {};
  for (let i = 0; i < t.w.localStorage.length; i++) {
    const key = t.w.localStorage.key(i);
    saved[key] = t.w.localStorage.getItem(key);
  }
  t.w.close();
  return bootPlayback({ beforeParse(win) {
    for (const [key, value] of Object.entries(saved)) win.localStorage.setItem(key, value);
    if (blockAutoplay) win.HTMLMediaElement.prototype.play = () => win.Promise.reject(new win.DOMException('blocked', 'NotAllowedError'));
  } });
}
const loadedAtLaunch = (t) => t.w.document.getElementById('audio-player').getAttribute('src');
const IDLE_LABEL = S1.label;

async function playingWithResume() {
  const t = bootPlayback({ cfg: { resume: 'on' } });
  t.w.playStream('s1');
  await t.clock.tick(CONNECT_MS);
  assert.equal(t.label('s1'), S1.label + ' (on)');
  return t;
}

test('Resume on: the app closing while a station plays restarts it on the next launch', async () => {
  const next = relaunch(await playingWithResume());
  assert.equal(next.label('s1'), S1.label + ' (on)');
  assert.equal(loadedAtLaunch(next), S1.url);
});

test('Resume on: after Stop, the next launch stays silent', async () => {
  const t = await playingWithResume();
  t.w.userStop();
  const next = relaunch(t);
  assert.equal(next.label('s1'), IDLE_LABEL);
  assert.equal(loadedAtLaunch(next), null, 'nothing loaded');
});

test('Resume on: after the sleep timer ends, the next launch stays silent', async () => {
  const t = await playingWithResume();
  t.w.setSleep(1);
  await t.clock.tick(61000);
  assert.equal(t.label('s1'), IDLE_LABEL, 'the timer stopped playback');
  const next = relaunch(t);
  assert.equal(next.label('s1'), IDLE_LABEL);
  assert.equal(loadedAtLaunch(next), null);
});

const PAUSE_PATHS = {
  'the lock screen': (t) => t.w.softStop(),
  'an outside pause (a call, another app)': (t) => t.audio.externalPause(),
};
for (const [how, pause] of Object.entries(PAUSE_PATHS)) {
  test(`Resume on: paused by ${how}, the next launch stays silent`, async () => {
    const t = await playingWithResume();
    pause(t);
    await t.clock.tick(0);
    assertTapToPlay(t, 's1');
    const next = relaunch(t);
    assert.equal(next.label('s1'), IDLE_LABEL);
    assert.equal(loadedAtLaunch(next), null);
  });
}

// The other half: playing again after a pause counts as playing.
const UNPAUSE_PATHS = {
  'a call, then a tap on the station': [(t) => t.audio.externalPause(), (t) => t.w.playStream('s1')],
  'the lock screen': [(t) => t.w.softStop(), (t) => t.w.softStop()],
  'an outside pause and the system playing again': [
    (t) => t.audio.externalPause(),
    (t) => t.w.document.getElementById('audio-player').play(), // the OS handing audio focus back
  ],
};
for (const [how, [pause, unpause]] of Object.entries(UNPAUSE_PATHS)) {
  test(`Resume on: paused and resumed by ${how}, the next launch restarts it`, async () => {
    const t = await playingWithResume();
    pause(t);
    await t.clock.tick(0);
    unpause(t);
    await t.clock.tick(CONNECT_MS);
    assert.equal(t.label('s1'), S1.label + ' (on)');
    const next = relaunch(t);
    assert.equal(next.label('s1'), S1.label + ' (on)');
  });
}

test('Resume on: a launch whose autoplay was blocked still offers the station the next time', async () => {
  // Autoplay refused is not the listener pausing: the station stays remembered.
  const blocked = relaunch(await playingWithResume(), { blockAutoplay: true });
  await blocked.clock.tick(0);
  assertTapToPlay(blocked, 's1');
  const next = relaunch(blocked);
  assert.equal(next.label('s1'), S1.label + ' (on)');
});

test('a station left playing with Resume off never starts by itself once Resume is turned on (unhappy path)', async () => {
  const t = bootPlayback();
  t.w.playStream('s1');
  await t.clock.tick(CONNECT_MS); // the app closes while playing, with Resume off
  const off = relaunch(t);
  assert.equal(off.label('s1'), IDLE_LABEL);
  off.w.localStorage.setItem('rgxl_cfg', JSON.stringify({ streams: STREAMS, resume: 'on' })); // Resume turned on, nothing played
  const next = relaunch(off);
  assert.equal(next.label('s1'), IDLE_LABEL);
  assert.equal(loadedAtLaunch(next), null);
});

test('Resume on: a station an older version kept through Stop stays off at the launch after an update reload (unhappy path)', async () => {
  // Older versions left rgxl_last set after Stop. The silent update reload
  // only runs while nothing plays, so it must forget the station too.
  const updated = bootPlayback({ beforeParse(win) {
    win.localStorage.setItem('rgxl_cfg', JSON.stringify({ streams: STREAMS, resume: 'on' }));
    win.localStorage.setItem('rgxl_last', 's1');
    win.sessionStorage.setItem('rgxl_update_reload', '1');
  } });
  assert.equal(updated.label('s1'), IDLE_LABEL, 'the update reload itself stays silent');
  const next = relaunch(updated); // later: a power cut, the browser dropping the tab
  assert.equal(next.label('s1'), IDLE_LABEL);
  assert.equal(loadedAtLaunch(next), null);
});

// ── Reconnect when a live station drops or stalls (ACCEPTANCE.md) ──────────
// A server hanging up, or no audio arriving for 20 s, is a lost connection:
// "Reconnecting…" and a quiet retry, never "Paused". Each loss uses one of 4
// tries; a minute of play resets them. Nothing here may restart a radio the
// listener paused or stopped.

const STALL_MS = 20000;
const STALL_CHECK_MS = 2000; // so a stall is noticed 20-22 s after audio stops
const RETRY_MS = 4000;
const MINUTE = 60 * 1000;
const stopBar = (t) => t.w.document.getElementById('simple-stop').getAttribute('aria-label');
const isFailed = (t) => t.button('s1').classList.contains('failed');
const flashOn = (t) => !!t.w.document.querySelector('.tap-flash.flash');

async function startPlaying(t) {
  t.w.playStream('s1');
  await t.clock.tick(CONNECT_MS + 2000);
  assert.equal(t.label('s1'), S1.label + ' (on)');
}

const LOSSES = {
  'the server hangs up': async (t) => { t.audio.hangUp(); await t.clock.tick(0); },
  'the server hangs up and no length is reported': async (t) => { t.audio.hangUp({ reportLength: false }); await t.clock.tick(0); },
  'the server hangs up, Chromium-style (an error)': async (t) => { t.audio.hangUp({ engine: 'chromium' }); await t.clock.tick(0); },
  // WebKit fires nothing and keeps reporting "playing": only the stall check sees it.
  'the server hangs up, WebKit-style (silence, no events)': async (t) => { t.audio.hangUp({ engine: 'webkit' }); await t.clock.tick(STALL_MS + STALL_CHECK_MS + 100); },
  'no audio arrives for 20 seconds': async (t) => { t.audio.freeze(); await t.clock.tick(STALL_MS + STALL_CHECK_MS + 100); },
};

for (const [loss, lose] of Object.entries(LOSSES)) {
  test(`${loss}: it reads "Reconnecting…", never "Paused", and comes back by itself`, async () => {
    const t = bootPlayback();
    await startPlaying(t);
    await lose(t);
    assert.equal(t.label('s1'), S1.label + ', reconnecting (on)');
    assert.equal(t.button('s1').querySelector('.btn-status').textContent, 'Reconnecting…');
    assert.doesNotMatch(stopBar(t), /Resume/, 'no "Resume" on the stop bar');
    await t.clock.tick(RETRY_MS + CONNECT_MS);
    assert.equal(t.label('s1'), S1.label + ' (on)');
    assert.equal(t.audio.state.paused, false);
  });
}

test('a station that answers but never sends reads "Reconnecting…" after 20 seconds, then plays once it sends', async () => {
  const t = bootPlayback();
  t.audio.route(S1.url, 'hang');
  t.w.playStream('s1');
  await t.clock.tick(STALL_MS - 1000);
  assert.doesNotMatch(t.label('s1'), /, reconnecting/, 'not before 20 seconds');
  await t.clock.tick(1100);
  assert.equal(t.label('s1'), S1.label + ', reconnecting (on)');
  t.audio.route(S1.url, 'live');
  await t.clock.tick(RETRY_MS + CONNECT_MS);
  assert.equal(t.label('s1'), S1.label + ' (on)');
});

test('a station that buffers for a few seconds now and then is never reloaded', async () => {
  const t = bootPlayback();
  await startPlaying(t);
  const fetches = t.audio.fetches.length;
  for (let i = 0; i < 10; i++) {
    await t.clock.tick(50000);
    t.audio.freeze();
    await t.clock.tick(5000);
    t.audio.unfreeze();
  }
  await t.clock.tick(1000);
  assert.equal(t.audio.fetches.length, fetches, 'no reload');
  assert.equal(t.label('s1'), S1.label + ' (on)');
});

test('a stall that clears by itself before its reconnect keeps playing, with no reload', async () => {
  const t = bootPlayback();
  await startPlaying(t);
  t.audio.freeze();
  await t.clock.tick(STALL_MS + STALL_CHECK_MS + 100);
  assert.equal(t.label('s1'), S1.label + ', reconnecting (on)');
  const fetches = t.audio.fetches.length;
  t.audio.unfreeze();
  await t.clock.tick(RETRY_MS + 1000);
  assert.equal(t.audio.fetches.length, fetches, 'the pending reconnect was dropped');
  assert.equal(t.label('s1'), S1.label + ' (on)');
});

test('a tap on a station that reads "Reconnecting…" tries it again at once', async () => {
  const t = bootPlayback();
  await startPlaying(t);
  t.audio.hangUp();
  await t.clock.tick(0);
  const fetches = t.audio.fetches.length;
  t.w.playStream('s1');
  await t.clock.tick(0);
  assert.ok(t.audio.fetches.length > fetches, 'reloaded now, not in 4 seconds');
  await t.clock.tick(CONNECT_MS);
  assert.equal(t.label('s1'), S1.label + ' (on)');
});

for (const sleep of [false, true]) {
  test(`a reconnect makes no chime, voice, buzz or flash${sleep ? ', with the sleep timer running' : ''}`, async () => {
    const t = bootPlayback({ cfg: { tts: 'on' } });
    await startPlaying(t);
    if (sleep) t.w.setSleep(30);
    await t.clock.tick(3000);
    const before = { spoken: t.spoken.length, chimes: t.chime.chimes, buzzes: t.buzz.count };
    let flash = false;
    const watch = async (ms) => { for (let i = 0; i < ms; i += 100) { await t.clock.tick(100); if (flashOn(t)) flash = true; } };
    t.audio.hangUp();
    await watch(RETRY_MS + 1000);
    t.audio.freeze();
    await watch(STALL_MS + STALL_CHECK_MS + RETRY_MS + 1000);
    assert.equal(t.label('s1'), S1.label + ' (on)', 'back after both');
    assert.deepEqual(
      { spoken: t.spoken.length, chimes: t.chime.chimes, buzzes: t.buzz.count, flash },
      { ...before, flash: false },
      'not announced again either'
    );
  });
}

test('a station still on its first connect says "Now playing" once, when it finally plays', async () => {
  const t = bootPlayback({ cfg: { tts: 'on' } });
  t.audio.route(S1.url, 'hang');
  t.w.playStream('s1');
  await t.clock.tick(STALL_MS + 100);
  t.audio.route(S1.url, 'live');
  await t.clock.tick(RETRY_MS + CONNECT_MS + 2000);
  assert.deepEqual(t.spoken, ['Connecting to ' + S1.label, 'Now playing ' + S1.label]);
});

test('the sound fades back in after a reconnect, as after a tap', async () => {
  const t = bootPlayback();
  await startPlaying(t);
  await t.clock.tick(5000);
  const el = t.w.document.getElementById('audio-player');
  assert.equal(el.volume, 1, 'full volume before');
  t.audio.hangUp();
  await t.clock.tick(RETRY_MS + CONNECT_MS);
  assert.equal(t.label('s1'), S1.label + ' (on)');
  assert.ok(el.volume < 0.1, `starts near silent (${el.volume})`);
  await t.clock.tick(2000);
  assert.ok(el.volume > 0.3 && el.volume < 0.7, `halfway up (${el.volume})`);
  await t.clock.tick(2500);
  assert.equal(el.volume, 1, 'back to full');
});

// Unhappy paths: nothing restarts on its own.

/** True if the radio stays silent and loads nothing for `ms`. */
async function staysSilent(t, ms = 2 * MINUTE) {
  const fetches = t.audio.fetches.length;
  await t.clock.tick(ms);
  return t.audio.state.paused && t.audio.fetches.length === fetches;
}

test('a hang-up while paused stays silent and still reads "Paused" (unhappy path)', async () => {
  const t = bootPlayback();
  await startPlaying(t);
  t.w.softStop();
  await t.clock.tick(0);
  t.audio.hangUp();
  assert.equal(await staysSilent(t), true);
  assertTapToPlay(t, 's1');
});

test('a station that goes quiet while paused is never reloaded (unhappy path)', async () => {
  const t = bootPlayback();
  await startPlaying(t);
  t.w.softStop();
  await t.clock.tick(0);
  t.audio.freeze();
  assert.equal(await staysSilent(t, 10 * MINUTE), true);
});

test('a start the browser blocked waits for a tap, however long (unhappy path)', async () => {
  const t = bootPlayback();
  t.audio.blockAutoplay = true;
  t.w.playStream('s1');
  await t.clock.tick(0);
  assert.equal(await staysSilent(t, 10 * MINUTE), true);
});

const PAUSES_DURING_RECONNECT = {
  'the stop bar pauses it': (t) => t.w.softStop(),
  'Stop is pressed': (t) => t.w.userStop(),
  'the lock screen pauses it': (t) => t.handlers.pause(),
};
for (const [pause, act] of Object.entries(PAUSES_DURING_RECONNECT)) {
  for (const [loss, lose] of Object.entries(LOSSES)) {
    test(`${loss}, then ${pause} while it reads "Reconnecting…": it stays silent (unhappy path)`, async () => {
      const t = bootPlayback({ mediaSession: true });
      await startPlaying(t);
      await lose(t);
      assert.equal(t.label('s1'), S1.label + ', reconnecting (on)');
      act(t);
      await t.clock.tick(0);
      assert.equal(await staysSilent(t, 10 * MINUTE), true);
    });
  }
}

test('the system pausing it (a call) while a stall reads "Reconnecting…": it stays silent (unhappy path)', async () => {
  const t = bootPlayback();
  await startPlaying(t);
  await LOSSES['no audio arrives for 20 seconds'](t);
  t.audio.externalPause();
  await t.clock.tick(0);
  assertTapToPlay(t, 's1');
  assert.equal(await staysSilent(t, 10 * MINUTE), true);
});

test('the sleep timer ending while it reads "Reconnecting…": it stays stopped (unhappy path)', async () => {
  const t = bootPlayback();
  await startPlaying(t);
  t.w.setSleep(1);
  await t.clock.tick(MINUTE - 2000);
  t.audio.hangUp();
  await t.clock.tick(0);
  assert.equal(t.label('s1'), S1.label + ', reconnecting (on)');
  await t.clock.tick(2500); // the timer ends before the reconnect is due
  assert.equal(t.label('s1'), S1.label);
  assert.equal(await staysSilent(t, 10 * MINUTE), true);
});

test('a recording reaching its end stays ended, as today (unhappy path)', async () => {
  const t = bootPlayback();
  t.audio.route(S1.url, 'vod');
  t.w.playStream('s1');
  await t.clock.tick(CONNECT_MS + 2000);
  t.audio.hangUp({ reportLength: false }); // the end of the file
  await t.clock.tick(0);
  assertTapToPlay(t, 's1');
  assert.equal(await staysSilent(t, 10 * MINUTE), true);
});

// Unhappy paths: the 4 tries.

for (const sleep of [false, true]) {
  test(`a server that answers but never sends greys out within 100 seconds${sleep ? ', in text only while the sleep timer runs' : ''} (unhappy path)`, async () => {
    const t = bootPlayback({ cfg: { tts: 'on' } });
    if (sleep) t.w.setSleep(30);
    t.audio.route(S1.url, 'hang');
    t.w.playStream('s1');
    const chimes = t.chime.chimes; // the tap's own chime is already counted
    await t.clock.tick(100 * 1000);
    assert.equal(isFailed(t), true);
    assert.equal(t.conn(), NOT_AVAILABLE(S1.label));
    assert.equal(t.spoken.includes(NOT_AVAILABLE(S1.label)), !sleep, sleep ? 'not said while the sleep timer runs' : 'said when no sleep timer runs');
    if (sleep) assert.equal(t.chime.chimes, chimes, 'no chime either');
  });
}

test('a station that cuts out within a minute of every reconnect greys out after 4 (unhappy path)', async () => {
  const t = bootPlayback();
  await startPlaying(t);
  for (let cut = 1; cut <= 4; cut++) {
    await t.clock.tick(30000);
    t.audio.hangUp();
    await t.clock.tick(0);
    assert.equal(isFailed(t), cut === 4, `after cut ${cut}`);
    if (cut < 4) await t.clock.tick(RETRY_MS + CONNECT_MS);
  }
  assert.equal(await staysSilent(t, 10 * MINUTE), true, 'and stays off');
});

test('a station that plays a full minute before each cut-out starts a fresh 4 tries each time', async () => {
  const t = bootPlayback();
  await startPlaying(t);
  for (let cut = 1; cut <= 8; cut++) {
    await t.clock.tick(MINUTE + 1000);
    t.audio.hangUp();
    await t.clock.tick(RETRY_MS + CONNECT_MS);
    assert.equal(isFailed(t), false, `after cut ${cut}`);
  }
  assert.equal(t.label('s1'), S1.label + ' (on)');
});

test('a server that cuts everyone off every hour and is back within 10 seconds keeps coming back all night', async () => {
  const t = bootPlayback();
  await startPlaying(t);
  for (let hour = 1; hour <= 8; hour++) {
    await t.clock.tick(60 * MINUTE - 10000);
    t.audio.route(S1.url, 'dead');
    t.audio.hangUp();
    await t.clock.tick(10000);
    t.audio.route(S1.url, 'live');
    await t.clock.tick(RETRY_MS + CONNECT_MS);
    assert.equal(t.label('s1'), S1.label + ' (on)', `hour ${hour}`);
  }
  assert.equal(isFailed(t), false);
});

// Offline.

test('offline, a stalled station waits on the no-network dialog without using its tries, and loads once when Wi-Fi returns', async () => {
  const t = bootPlayback();
  await startPlaying(t);
  t.setOnline(false);
  t.audio.freeze(); // the stream runs dry with the Wi-Fi
  await t.clock.tick(0);
  assert.equal(t.overlayShown(), true);
  const fetches = t.audio.fetches.length;
  await t.clock.tick(10 * MINUTE);
  assert.equal(isFailed(t), false, 'not greyed out');
  assert.equal(t.audio.fetches.length, fetches, 'nothing loaded while offline');
  assert.equal(t.overlayShown(), true);
  t.setOnline(true);
  await t.clock.tick(10000);
  assert.equal(t.audio.fetches.length, fetches + 2, 'one load (src then load() logs twice)');
  assert.equal(t.label('s1'), S1.label + ' (on)');
});

test('a station on weak Wi-Fi that buffers briefly and drops every 2 minutes keeps coming back (unhappy path)', async () => {
  // Each brief buffer fires 'playing' again. The minute that resets the tries
  // runs from the reconnect, not from the latest buffer.
  const t = bootPlayback();
  await startPlaying(t);
  for (let cut = 1; cut <= 10; cut++) {
    for (let i = 0; i < 2; i++) {
      await t.clock.tick(50000);
      t.audio.freeze();
      await t.clock.tick(3000);
      t.audio.unfreeze();
    }
    await t.clock.tick(10000);
    t.audio.hangUp();
    await t.clock.tick(RETRY_MS + CONNECT_MS);
    assert.equal(isFailed(t), false, `after drop ${cut}`);
  }
  assert.equal(t.label('s1'), S1.label + ' (on)');
});

// Review follow-ups (intent review, 2026-10-26).

test('a recording whose length arrives only after it loads plays to its end and stays there (unhappy path)', async () => {
  // Served without a length, it loads looking live; the length learned later
  // shows it's a recording, whose end must not reconnect and replay it.
  const t = bootPlayback();
  await startPlaying(t);
  t.audio.learnLength(600);
  await t.clock.tick(10000);
  t.audio.hangUp({ reportLength: false }); // the end of the file
  await t.clock.tick(0);
  assert.doesNotMatch(t.label('s1'), /, reconnecting/);
  assert.equal(await staysSilent(t, 30 * MINUTE), true);
});

test('a station that freezes 45 seconds after every reconnect still greys out after 4 (unhappy path)', async () => {
  // The minute that resets the tries is a minute of playback: the 20 s a
  // stall takes to notice doesn't count towards it.
  const t = bootPlayback();
  await startPlaying(t);
  for (let cut = 1; cut <= 4; cut++) {
    await t.clock.tick(45000);
    t.audio.freeze();
    await t.clock.tick(STALL_MS + STALL_CHECK_MS + 100);
    assert.equal(isFailed(t), cut === 4, `after freeze ${cut}`);
    if (cut < 4) await t.clock.tick(RETRY_MS + CONNECT_MS);
  }
});

test('a recording that buffers for a long time keeps its place: the stall check never reloads it', async () => {
  const t = bootPlayback();
  t.audio.route(S1.url, 'vod');
  t.w.playStream('s1');
  await t.clock.tick(CONNECT_MS + 120000);
  const fetches = t.audio.fetches.length;
  t.audio.freeze();
  await t.clock.tick(5 * MINUTE);
  assert.equal(t.audio.fetches.length, fetches, 'not reloaded from the start');
  assert.doesNotMatch(t.label('s1'), /, reconnecting/);
});

test('hung up while paused: resuming reloads at once instead of playing a dead stream', async () => {
  const t = bootPlayback();
  await startPlaying(t);
  t.w.softStop();
  await t.clock.tick(0);
  t.audio.hangUp();
  await t.clock.tick(MINUTE);
  const fetches = t.audio.fetches.length;
  t.w.softStop(); // resume
  await t.clock.tick(0);
  assert.ok(t.audio.fetches.length > fetches, 'reloaded on resume');
  await t.clock.tick(CONNECT_MS);
  assert.equal(t.label('s1'), S1.label + ' (on)');
});

// ── Fade-in and pause ─────────────────────────────────────────────────────
test('pausing during the fade-in stops it; resuming fades in again from silence', async () => {
  const t = bootPlayback();
  const el = t.w.document.getElementById('audio-player');
  t.w.playStream('s1');
  await t.clock.tick(CONNECT_MS + 1000); // a quarter into the 4 s fade
  const partway = el.volume;
  assert.ok(partway > 0 && partway < 0.5, 'fade under way: ' + partway);

  t.w.softStop(); // paused from the lock screen
  await t.clock.tick(5000);
  assert.ok(el.volume <= partway, 'volume did not keep climbing while paused: ' + el.volume);

  t.w.playStream('s1'); // resumed with a tap
  await t.clock.tick(CONNECT_MS);
  assert.ok(el.volume < partway, 'resume starts quiet, not at full: ' + el.volume);
  await t.clock.tick(5000);
  assert.ok(el.volume > partway, 'and fades back up: ' + el.volume);
});

test('a pause right after a tap shows idle, not buffering (unhappy path: late "waiting")', async () => {
  const t = bootPlayback();
  const shown = [];
  // Registered after the app's own listener, so it sees what that left.
  t.w.document.getElementById('audio-player').addEventListener('waiting', () => shown.push(t.conn()));
  t.w.playStream('s1');
  t.w.softStop(); // the lock screen, before the stream has any audio
  await t.clock.tick(CONNECT_MS);
  assert.equal(t.audio.state.paused, true);
  // Pausing live radio now drops the connection, which discards the queued
  // "waiting" outright; where an engine still delivers it, it must not show.
  assert.deepEqual(shown.filter(x => x !== 'Connection: idle'), [], 'never flips to buffering while paused');
  assert.equal(t.conn(), 'Connection: idle');
});

// ── Resuming live radio ───────────────────────────────────────────────────
test('resuming a paused live station reconnects at the live point instead of playing a stale buffer', async () => {
  const t = bootPlayback({ cfg: { advanced: 'on' } });
  t.w.playStream('s1');
  await t.clock.tick(CONNECT_MS + 2000);
  t.w.document.getElementById('adv-pause').click(); // pause
  await t.clock.tick(30000);
  const fetches = t.audio.fetches.length;
  t.w.document.getElementById('adv-pause').click(); // resume
  await t.clock.tick(0);
  assert.ok(t.audio.fetches.length > fetches, 'a fresh connection, not play() on what iOS stopped downloading');
  await t.clock.tick(CONNECT_MS + 3000);
  assert.equal(t.label('s1'), STREAMS[0].label + ' (on)', 'and it keeps playing');
  assert.equal(t.w.eval('paused'), false);
});

test('resuming a paused recording carries on from where it was — unhappy path for the live reload', async () => {
  const t = bootPlayback();
  t.audio.route(STREAMS[0].url, 'vod');
  t.w.playStream('s1');
  await t.clock.tick(CONNECT_MS + 10000);
  t.w.softStop(); // pause
  await t.clock.tick(1000);
  assert.equal(t.audio.state.paused, true);
  const fetches = t.audio.fetches.length;
  const at = t.audio.state.currentTime;
  t.w.playStream('s1'); // resume
  await t.clock.tick(CONNECT_MS);
  assert.equal(t.audio.fetches.length, fetches, 'no reload');
  assert.ok(t.audio.state.currentTime >= at, 'same place');
});

test('pausing live radio lets go of the connection; resuming starts it fresh', async () => {
  const t = bootPlayback({ cfg: { advanced: 'on' } });
  t.w.playStream('s1');
  await t.clock.tick(CONNECT_MS + 2000);
  t.w.document.getElementById('adv-pause').click();
  assert.equal(t.audio.state.src, null, 'no source held open while paused');
  assertTapToPlay(t, 's1');
  const fetches = t.audio.fetches.length;
  t.w.document.getElementById('adv-pause').click();
  await t.clock.tick(CONNECT_MS + 1000);
  const fresh = t.audio.fetches.slice(fetches);
  assert.ok(fresh.length > 0 && fresh.every((u) => u === S1.url), 'a fresh load of the same station');
  assert.equal(t.label('s1'), S1.label + ' (on)');
});

test('quick pause and resume taps, again and again, end playing with nothing wedged — unhappy path', async () => {
  const t = bootPlayback({ cfg: { advanced: 'on' } });
  const pause = t.w.document.getElementById('adv-pause');
  t.w.playStream('s1');
  await t.clock.tick(1500); // mid fade-in
  for (let i = 0; i < 8; i++) {
    pause.click(); await t.clock.tick(i % 3 === 0 ? 0 : 200);
    pause.click(); await t.clock.tick(i % 2 === 0 ? 10 : 300);
  }
  await t.clock.tick(CONNECT_MS + 5000);
  assert.equal(t.w.eval('paused'), false);
  assert.equal(t.audio.state.paused, false, 'the element really plays');
  assert.equal(t.label('s1'), S1.label + ' (on)');
  assert.ok(t.w.document.getElementById('audio-player').volume > 0.9, 'and faded all the way up');
  // And one more pause still pauses.
  pause.click();
  assert.equal(t.audio.state.paused, true);
  assertTapToPlay(t, 's1');
});

// ── Tiles play, Stop stops ────────────────────────────────────────────────
const stopPointed = (t) => t.w.document.getElementById('simple-stop').classList.contains('point');

test('a second tap on the playing station points at Stop for a moment, silently', async () => {
  const t = bootPlayback({ cfg: { tts: 'on' } });
  t.w.playStream('s1');
  await t.clock.tick(CONNECT_MS + 2000);
  const before = { spoken: t.spoken.length, chimes: t.chime.chimes, fetches: t.audio.fetches.length };
  t.button('s1').click();
  assert.ok(stopPointed(t), 'Stop is highlighted');
  assert.ok(t.button('s1').querySelector('.tap-flash').classList.contains('flash'), 'the tile flashes');
  await t.clock.tick(1000);
  assert.ok(stopPointed(t), 'still there a second later: a still highlight, not a blink');
  await t.clock.tick(1500);
  assert.equal(stopPointed(t), false, 'gone after about two seconds');
  assert.deepEqual({ spoken: t.spoken.length, chimes: t.chime.chimes, fetches: t.audio.fetches.length }, before,
    'no voice, no chime, no reload');
  assert.equal(t.audio.state.paused, false);
});

test('in Advanced mode a second tap points at the Advanced Stop button', async () => {
  const t = bootPlayback({ cfg: { advanced: 'on' } });
  t.w.playStream('s1');
  await t.clock.tick(CONNECT_MS);
  t.w.playStream('s1');
  assert.ok(t.w.document.querySelector('#adv-transport .adv-stop').classList.contains('point'));
  t.w.userStop();
  assert.equal(t.w.document.querySelector('#adv-transport .adv-stop').classList.contains('point'), false, 'Stop clears it');
});

test('three quick taps on a station still starting load it once, and it plays (unhappy path: tremor)', async () => {
  const t = bootPlayback();
  t.audio.route(S1.url, 'slow');
  t.w.playStream('s1');
  const oneLoad = t.audio.fetches.length;
  t.w.playStream('s1');
  await t.clock.tick(300);
  t.w.playStream('s1');
  await t.clock.tick(SLOW_CONNECT_MS + 1000);
  assert.equal(t.audio.fetches.length, oneLoad, 'loaded once');
  assert.equal(t.audio.state.paused, false);
  assert.equal(t.label('s1'), S1.label + ' (on)');
});

test('five taps on a playing station: no reload and never a moment of silence (unhappy path)', async () => {
  const t = bootPlayback();
  t.w.playStream('s1');
  await t.clock.tick(CONNECT_MS + 1000);
  const fetches = t.audio.fetches.length;
  for (let i = 0; i < 5; i++) {
    t.button('s1').click();
    assert.equal(t.audio.state.paused, false, 'tap ' + (i + 1) + ' left it playing');
    await t.clock.tick(150);
  }
  assert.equal(t.audio.fetches.length, fetches);
});

test('a station that is starting reads "Starting…" until its sound arrives', async () => {
  const t = bootPlayback();
  t.audio.route(S1.url, 'slow');
  t.w.playStream('s1');
  await t.clock.tick(1000);
  assert.equal(t.status('s1'), 'Starting…');
  assert.equal(t.label('s1'), S1.label + ' (on)', 'already the current station');
  await t.clock.tick(SLOW_CONNECT_MS);
  assert.equal(t.status('s1'), '', 'the description is back once it plays');
});

test('a playing station shows the speaker mark; no station shows ▮▮, ■ or ▶', async () => {
  const t = bootPlayback();
  t.w.playStream('s1');
  await t.clock.tick(CONNECT_MS);
  assert.ok(t.button('s1').querySelector('.btn-state .playing-mark'), 'the playing tile has the speaker');
  t.audio.externalPause();
  await t.clock.tick(0);
  const marks = Array.from(t.w.document.querySelectorAll('#buttons .btn-state'), (el) => el.textContent).join('');
  assert.doesNotMatch(marks, /[▮■▶]/);
  assert.equal(t.w.document.querySelectorAll('#buttons .stream-btn.paused').length, 0, 'no dashed paused ring');
});

test('the Simple bar always reads Stop and always stops, even after a call', async () => {
  const t = bootPlayback({ mediaSession: true });
  const bar = t.w.document.getElementById('simple-stop');
  const barLabel = () => t.w.document.getElementById('simple-stop-label').textContent;
  t.w.playStream('s1');
  await t.clock.tick(CONNECT_MS);
  assert.equal(barLabel(), 'Stop');
  assert.equal(bar.getAttribute('aria-disabled'), 'false');
  t.audio.externalPause(); // a call
  await t.clock.tick(0);
  assert.equal(barLabel(), 'Stop', 'never "Resume …"');
  assert.equal(bar.getAttribute('aria-label'), 'Stop playback');
  assert.equal(bar.classList.contains('active'), false, 'looks idle: nothing is playing');
  bar.click();
  await t.clock.tick(CONNECT_MS);
  assert.equal(t.w.eval('playing'), null, 'cleared to off');
  assert.equal(t.audio.state.paused, true);
  t.handlers.play(); // the lock screen's Play after a Stop has nothing to resume
  await t.clock.tick(CONNECT_MS);
  assert.equal(t.audio.state.paused, true, 'stopped stays stopped');
});

test('after a call, one tap on the tile plays it again', async () => {
  const t = bootPlayback();
  t.w.playStream('s1');
  await t.clock.tick(CONNECT_MS);
  t.audio.externalPause();
  await t.clock.tick(0);
  assertTapToPlay(t, 's1');
  t.button('s1').click();
  await t.clock.tick(CONNECT_MS);
  assert.equal(t.audio.state.paused, false);
  assert.equal(t.label('s1'), S1.label + ' (on)');
  assert.equal(t.status('s1'), '');
});

test('Advanced: a live station has no Pause button; a recording has Pause, and it pauses and resumes', async () => {
  const t = bootPlayback({ cfg: { advanced: 'on' } });
  const pause = t.w.document.getElementById('adv-pause');
  t.w.playStream('s1');
  await t.clock.tick(CONNECT_MS);
  assert.equal(pause.style.display, 'none', 'live radio: Stop only');
  t.audio.route(S2.url, 'vod');
  t.w.playStream('s2');
  await t.clock.tick(CONNECT_MS);
  assert.equal(pause.style.display, '', 'a recording gets Pause');
  pause.click();
  await t.clock.tick(0);
  assert.equal(t.audio.state.paused, true);
  assert.equal(pause.getAttribute('aria-label'), 'Resume');
  assert.ok(t.w.document.getElementById('adv-transport').classList.contains('paused'));
  pause.click();
  await t.clock.tick(CONNECT_MS);
  assert.equal(t.audio.state.paused, false);
});

test('Advanced: a live station cut off by a call leaves the bar idle, not amber', async () => {
  const t = bootPlayback({ cfg: { advanced: 'on' } });
  t.w.playStream('s1');
  await t.clock.tick(CONNECT_MS);
  t.audio.externalPause();
  await t.clock.tick(0);
  const bar = t.w.document.getElementById('advTransport') || t.w.document.getElementById('adv-transport');
  assert.equal(bar.classList.contains('paused'), false);
  assert.equal(bar.classList.contains('has-playing'), false);
  assertTapToPlay(t, 's1');
});

// ── Recordings keep their place ───────────────────────────────────────────
const pos = (t) => t.w.document.getElementById('audio-player').currentTime;
test('a recording stopped and tapped again carries on from where it stopped', async () => {
  const t = bootPlayback();
  t.audio.route(S1.url, 'vod');
  t.w.playStream('s1');
  await t.clock.tick(CONNECT_MS + 30000);
  const at = pos(t);
  assert.ok(at > 25, 'played about 30 s: ' + at);
  t.w.simpleStopPress();
  await t.clock.tick(5000);
  t.w.playStream('s1');
  await t.clock.tick(CONNECT_MS + 100);
  assert.ok(pos(t) >= at, 'carried on: ' + pos(t));
  assert.ok(pos(t) < at + 5, 'not further on than it was');
});

test('switching away from a recording and back carries on from the same place', async () => {
  const t = bootPlayback();
  t.audio.route(S1.url, 'vod');
  t.w.playStream('s1');
  await t.clock.tick(CONNECT_MS + 20000);
  const at = pos(t);
  t.w.playStream('s2');
  await t.clock.tick(CONNECT_MS + 5000);
  t.w.playStream('s1');
  await t.clock.tick(CONNECT_MS + 100);
  assert.ok(pos(t) >= at && pos(t) < at + 5, 'at ' + pos(t));
});

test('a recording that reached its end starts over on the next tap (unhappy path)', async () => {
  const t = bootPlayback();
  t.audio.route(S1.url, 'vod');
  t.w.playStream('s1');
  await t.clock.tick(CONNECT_MS + 601000); // past the 600 s recording's end
  t.w.simpleStopPress();
  t.w.playStream('s1');
  await t.clock.tick(CONNECT_MS + 100);
  assert.ok(pos(t) < 5, 'from the start: ' + pos(t));
});

test('live radio never seeks: a stop and a tap start it at the live point', async () => {
  const t = bootPlayback();
  t.w.playStream('s1');
  await t.clock.tick(CONNECT_MS + 30000);
  t.w.simpleStopPress();
  t.w.playStream('s1');
  await t.clock.tick(CONNECT_MS + 100);
  assert.ok(pos(t) < 5, 'a fresh connection: ' + pos(t));
  assert.equal(t.w.eval('recordingPlaces').size, 0, 'no place kept for live radio');
});
